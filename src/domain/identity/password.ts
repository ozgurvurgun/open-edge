export interface PasswordHash {
  readonly algorithm: "pbkdf2-sha256";
  readonly iterations: number;
  readonly salt: string;
  readonly hash: string;
}

export const PASSWORD_MIN_LENGTH = 12;
export const PBKDF2_ITERATIONS = 100_000;

export function validatePasswordPlaintext(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.trim() !== password || password.trim().length === 0) {
    return "Password cannot be empty or surrounded by whitespace.";
  }
  return null;
}
