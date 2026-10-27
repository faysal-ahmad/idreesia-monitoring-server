// pgvector's text representation is "[0.1,0.2,...]" — cast to/from ::vector in raw SQL,
// since Prisma has no native support for the vector(128) column type (Unsupported in schema.prisma).
export function vectorToSql(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export function parsePgVector(text: string): number[] {
  return text.slice(1, -1).split(',').map(Number);
}
