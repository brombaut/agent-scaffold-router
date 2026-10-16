/**
 * URL slug for a title: lowercase ASCII letters and digits, with each run of
 * anything else (spaces, punctuation) turned into a single dash and no dashes
 * at either end. Accents are stripped ("é" → "e"). Can be empty.
 */
export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
