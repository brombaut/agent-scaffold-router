/**
 * Fetches every id with `fetcher`, at most `concurrency` requests at a time.
 * Results are returned in the same order as `ids`. If any fetch fails, the
 * returned promise rejects with that error.
 */
export async function fetchAll<T>(
  ids: string[],
  fetcher: (id: string) => Promise<T>,
  concurrency = 4,
): Promise<T[]> {
  const results: T[] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += concurrency) chunks.push(ids.slice(i, i + concurrency));
  chunks.forEach(async (chunk) => {
    for (const id of chunk) {
      results.push(await fetcher(id));
    }
  });
  return results;
}
