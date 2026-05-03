function compactSnippet(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

export async function parseJsonResponse<T = unknown>(response: Response, label: string): Promise<T> {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();

  if (!contentType.toLowerCase().includes('json')) {
    const snippet = compactSnippet(text) || '본문 없음';
    throw new Error(`${label} 응답이 JSON이 아니에요 (${response.status} ${contentType || 'content-type 없음'}): ${snippet}`);
  }

  if (!text.trim()) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch (error: any) {
    throw new Error(`${label} JSON 파싱 실패: ${error?.message || '알 수 없는 오류'}`);
  }
}
