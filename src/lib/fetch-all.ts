/**
 * PostgREST 는 한 번에 최대 1000행만 돌려준다. .range() 로 끝까지 반복해서 가져온다.
 * .in() 에 넣을 id 가 많으면 URL 이 길어지므로 chunk 단위로 나눠 조회한다.
 */
export const PAGE_SIZE = 1000;
export const IN_CHUNK = 200;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** build(from, to) 는 매번 새 쿼리를 만들어 .range(from, to) 를 붙여 반환해야 한다. 정렬 키를 꼭 넣을 것. */
export async function fetchAll<T>(build: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

export function chunk<T>(arr: T[], size = IN_CHUNK): T[][] {
  const res: T[][] = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

/** ids 를 200개씩 나눠 fetchAll 로 조회해 합친다. */
export async function fetchAllIn<T>(
  ids: string[],
  build: (ids: string[], from: number, to: number) => PageResult<T>,
): Promise<T[]> {
  const uniq = Array.from(new Set(ids));
  const out: T[] = [];
  for (const part of chunk(uniq)) out.push(...(await fetchAll<T>((f, t) => build(part, f, t))));
  return out;
}
