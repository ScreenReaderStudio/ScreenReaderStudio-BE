import { supabase } from './supabaseClient.js';

export const saveAnalysis = async ({
  userId,
  pageContent,
  accessibilityAnalysis,
  screenReaderScript,
  selectedScreenReader,
  sourceJobId,
}) => {
  if (!userId || typeof userId !== 'string') {
    throw new Error('유효하지 않은 사용자 ID입니다.');
  }

  if (!pageContent || typeof pageContent !== 'string') {
    throw new Error('pageContent는 문자열이어야 합니다.');
  }

  if (typeof accessibilityAnalysis !== 'object' || accessibilityAnalysis === null) {
    throw new Error('accessibilityAnalysis는 객체여야 합니다.');
  }

  if (!Array.isArray(screenReaderScript)) {
    throw new Error('screenReaderScript는 배열이어야 합니다.');
  }

  if (!selectedScreenReader || typeof selectedScreenReader !== 'string') {
    throw new Error('selectedScreenReader는 문자열이어야 합니다.');
  }

  if (sourceJobId) {
    const { data: existing, error: findError } = await supabase
      .from('analyses')
      .select('id')
      .eq('user_id', userId)
      .eq('source_job_id', sourceJobId)
      .maybeSingle();

    if (findError) {
      throw new Error('기존 공유 분석 결과 조회에 실패했습니다.', { cause: findError });
    }

    if (existing) {
      return existing.id;
    }
  }

  const { data, error } = await supabase
    .from('analyses')
    .insert([
      {
        user_id: userId,
        page_content: pageContent,
        accessibility_analysis: accessibilityAnalysis,
        screen_reader_script: screenReaderScript,
        selected_screen_reader: selectedScreenReader,
        ...(sourceJobId ? { source_job_id: sourceJobId } : {}),
      },
    ])
    .select('id')
    .single();

  if (error) {
    if (sourceJobId && error.code === '23505') {
      const { data: existing } = await supabase
        .from('analyses')
        .select('id')
        .eq('user_id', userId)
        .eq('source_job_id', sourceJobId)
        .single();

      if (existing) {
        return existing.id;
      }
    }

    console.error('Error saving analysis:', error);
    throw new Error('데이터베이스 오류로 분석 결과 저장에 실패했습니다.');
  }

  return data.id;
};

export const getAnalysisById = async (id) => {
  const { data, error } = await supabase
    .from('analyses')
    .select('page_content, accessibility_analysis, screen_reader_script, selected_screen_reader')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching analysis by ID:', error);
    throw new Error(`분석 결과 조회 실패: ${error.message}`);
  }

  return {
    pageContent: data.page_content,
    accessibilityAnalysis: data.accessibility_analysis,
    screenReaderScript: data.screen_reader_script,
    selectedScreenReader: data.selected_screen_reader,
  };
};
