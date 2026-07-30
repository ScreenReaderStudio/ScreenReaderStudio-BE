import { analyzeAccessibility } from '../services/analysis/index.js';
import {
  AnalysisCancelledError,
  AnalysisError,
  InvalidAnalysisTargetError,
} from '../services/analysis/errors.js';
import { saveAnalysis, getAnalysisById } from '../services/analysisService.js';
import { getJob } from '../services/analysisJobs/repository.js';

export const performAnalysis = async (req, res) => {
  const abortController = new AbortController();
  const abortAnalysis = () => {
    if (!res.writableEnded) {
      abortController.abort(new AnalysisCancelledError());
    }
  };

  req.once('aborted', abortAnalysis);
  res.once('close', abortAnalysis);

  try {
    const { url, htmlContent, screenReader } = req.body;

    if (Boolean(url) === Boolean(htmlContent)) {
      throw new InvalidAnalysisTargetError('분석할 URL과 HTML 콘텐츠 중 하나만 제공해야 합니다.', {
        code: 'INVALID_REQUEST',
      });
    }

    if (!['voiceover', 'nvda'].includes(screenReader)) {
      throw new InvalidAnalysisTargetError('지원하지 않는 스크린 리더입니다.', {
        code: 'INVALID_REQUEST',
      });
    }

    const results = await analyzeAccessibility(
      { url, htmlContent, screenReader },
      { signal: abortController.signal }
    );

    res.status(200).json(results);
  } catch (error) {
    if (!(error instanceof AnalysisError && error.status < 500)) {
      console.error('분석 요청 처리 중 에러 발생:', error);
    }

    if (res.headersSent || res.writableEnded || abortController.signal.aborted) {
      return;
    }

    if (error instanceof AnalysisError) {
      return res.status(error.status).json({
        code: error.code,
        message: error.message,
      });
    }

    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: '서버 내부 오류가 발생했습니다.',
    });
  } finally {
    req.removeListener('aborted', abortAnalysis);
    res.removeListener('close', abortAnalysis);
  }
};

export const saveAnalysisResult = async (req, res) => {
  try {
    let { pageContent, accessibilityAnalysis, screenReaderScript, selectedScreenReader } = req.body;
    const userId = req.userId;
    const sourceJobId = req.body.jobId;

    if (!userId) {
      return res.status(401).json({ message: '인증되지 않은 사용자입니다.' });
    }

    if (sourceJobId) {
      const accessToken = req.get('X-Analysis-Job-Token') ?? '';
      const job = await getJob(sourceJobId, accessToken);

      if (!job) {
        return res
          .status(404)
          .json({ code: 'JOB_NOT_FOUND', message: '분석 작업을 찾을 수 없습니다.' });
      }

      if (job.status !== 'succeeded' || !job.result) {
        return res
          .status(409)
          .json({ code: 'JOB_NOT_READY', message: '분석 결과가 아직 준비되지 않았습니다.' });
      }

      ({ pageContent, accessibilityAnalysis, screenReaderScript } = job.result);
      selectedScreenReader =
        job.result.selectedScreenReader ?? job.screen_reader ?? req.body.selectedScreenReader;
    }

    if (!pageContent || typeof pageContent !== 'string' || pageContent.trim().length === 0) {
      return res.status(400).json({
        message: 'pageContent 필드는 비어 있지 않은 문자열이어야 합니다.',
      });
    }

    if (
      !accessibilityAnalysis ||
      typeof accessibilityAnalysis !== 'object' ||
      Object.keys(accessibilityAnalysis).length === 0
    ) {
      return res.status(400).json({
        message: 'accessibilityAnalysis 필드는 비어 있지 않은 객체여야 합니다.',
      });
    }

    if (
      !screenReaderScript ||
      !Array.isArray(screenReaderScript) ||
      screenReaderScript.length === 0
    ) {
      return res.status(400).json({
        message: 'screenReaderScript 필드는 비어 있지 않은 배열이어야 합니다.',
      });
    }

    if (
      !selectedScreenReader ||
      typeof selectedScreenReader !== 'string' ||
      selectedScreenReader.trim().length === 0
    ) {
      return res.status(400).json({
        message: 'selectedScreenReader 필드는 비어 있지 않은 문자열이어야 합니다.',
      });
    }

    const analysisId = await saveAnalysis({
      userId,
      pageContent,
      accessibilityAnalysis,
      screenReaderScript,
      selectedScreenReader,
      sourceJobId,
    });

    res.status(201).json({ id: analysisId, message: '분석 결과가 성공적으로 저장되었습니다.' });
  } catch (error) {
    console.error('분석 결과 저장 중 에러 발생:', error);
    res.status(500).json({ message: error.message || '서버 내부 오류가 발생했습니다.' });
  }
};

export const getAnalysisResult = async (req, res) => {
  try {
    const { id } = req.params;
    const analysis = await getAnalysisById(id);

    if (!analysis) {
      return res.status(404).json({ message: '분석 결과를 찾을 수 없습니다.' });
    }

    res.status(200).json(analysis);
  } catch (error) {
    console.error('분석 결과 조회 중 에러 발생:', error);
    res.status(500).json({ message: error.message || '서버 내부 오류가 발생했습니다.' });
  }
};
