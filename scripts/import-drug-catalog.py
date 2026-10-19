"""Build a deterministic, attributed lookup snapshot from HIRA dataset 15067462.
Usage: python scripts/import-drug-catalog.py source.csv --as-of 2026-08-31 --download-url URL
Download the CSV linked by https://www.data.go.kr/data/15067462/fileData.do first.
"""
import argparse, csv, gzip, hashlib, io, json, pathlib, re


def valid_gtin(code):
    return bool(re.fullmatch(r'\d{13,14}', code)) and sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(reversed(code))) % 10 == 0


def build(source, as_of, download_url, output):
    raw = pathlib.Path(source).read_bytes()
    text = raw.decode('utf-8-sig') if raw.startswith(b'\xef\xbb\xbf') else raw.decode('cp949')
    reader = csv.DictReader(io.StringIO(text))
    keys = ['한글상품명', '업체명', '약품규격', '제품총수량', '제형구분', '포장형태', '품목기준코드', '취소일자', '양도양수종료일자']
    if not all(k in (reader.fieldnames or []) for k in keys + ['표준코드']):
        raise ValueError('Unexpected HIRA CSV columns; no catalog was written')
    entries, invalid, rows = {}, 0, 0
    for row in reader:
        rows += 1
        code = (row['표준코드'] or '').strip()
        if not valid_gtin(code):
            invalid += 1
            continue
        if len(code) == 14 and code[0] == '0':
            code = code[1:]
        record = [(row[k] or '').strip() for k in keys]
        if not record[0]:
            raise ValueError('Product name missing')
        # Preserve conflicting records; the API must never choose one arbitrarily.
        if record not in entries.setdefault(code, []):
            entries[code].append(record)
    if len(entries) < 100000:
        raise ValueError('Unexpectedly small snapshot; check download completeness')
    metadata = {
        'provider': '건강보험심사평가원', 'title': '약가마스터_의약품표준코드',
        'sourceUrl': 'https://www.data.go.kr/data/15067462/fileData.do',
        'downloadUrl': download_url, 'asOf': as_of,
        'license': '공공누리 제1유형 (출처표시)', 'licenseUrl': 'https://www.kogl.or.kr/info/license.do',
        'scope': '심평원 공개 표준코드 목록의 정확한 코드만 조회. 전체 유통 의약품의 실시간 목록이나 현재 급여 여부를 보장하지 않음.',
        'sourceSha256': hashlib.sha256(raw).hexdigest(), 'sourceBytes': len(raw),
        'sourceRows': rows, 'codeCount': len(entries), 'invalidCodeRows': invalid,
        'conflictingCodeCount': sum(len(v) > 1 for v in entries.values()),
        'columns': keys,
    }
    payload = json.dumps(entries, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode()
    compressed = gzip.compress(payload, compresslevel=9, mtime=0)
    metadata['catalogSha256'] = hashlib.sha256(compressed).hexdigest()
    output.mkdir(parents=True, exist_ok=True)
    (output / 'drug-catalog.json.gz').write_bytes(compressed)
    (output / 'drug-catalog-source.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({**metadata, 'compressedBytes': len(compressed)}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source')
    parser.add_argument('--as-of', required=True)
    parser.add_argument('--download-url', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.as_of):
        parser.error('as-of must be YYYY-MM-DD')
    build(args.source, args.as_of, args.download_url, pathlib.Path(__file__).resolve().parents[1] / 'data')
