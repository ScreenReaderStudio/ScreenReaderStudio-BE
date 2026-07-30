import './config/env.js';

const nodeEnv = process.env.NODE_ENV || 'development';
console.log(`환경: ${nodeEnv}`);

const { createApp } = await import('./app.js');
const { createAnalysisWorker } = await import('./services/analysisJobs/worker.js');
const app = createApp();
const worker = createAnalysisWorker();

const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${nodeEnv}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  worker.start();
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${signal} 신호를 받아 서버를 종료합니다.`);
  const serverClosed = new Promise((resolve) => {
    server.close(resolve);
  });
  await Promise.all([serverClosed, worker.stop()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
