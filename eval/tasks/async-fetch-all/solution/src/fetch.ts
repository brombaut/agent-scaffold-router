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
  const results = new Array<T>(ids.length);
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const i = next++;
      results[i] = await fetcher(ids[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker));
  return results;
}
