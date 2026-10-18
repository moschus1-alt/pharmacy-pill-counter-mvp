// Replace this adapter to plug in an AI detector with the same result contract.
export class OpenCVDetector {
  constructor() { this.worker = null; this.pending = null; }
  analyze(imageData, parameters) {
    this.cancel();
    return new Promise((resolve, reject) => {
      const worker = this.worker = new Worker(new URL('./detector-worker.js', import.meta.url));
      const finish = (error, result) => {
        clearTimeout(timer); worker.terminate(); this.worker = null; this.pending = null;
        error ? reject(error) : resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('분석 시간이 초과되었습니다. 재분석하거나 수동으로 표시해주세요.')), 60000);
      this.pending = () => finish(new Error('분석이 취소되었습니다.'));
      worker.onerror = () => finish(new Error('검출 엔진을 불러오지 못했습니다. 인터넷 연결 후 다시 시도해주세요.'));
      worker.onmessage = ({data}) => data.error ? finish(new Error(data.error)) : finish(null, data);
      worker.postMessage({imageData, parameters}, [imageData.data.buffer]);
    });
  }
  cancel() { this.pending?.(); }
}
