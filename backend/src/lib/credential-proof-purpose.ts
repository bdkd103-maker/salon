export const CUSTOMER_PASSWORD_RESET = 'CUSTOMER_PASSWORD_RESET';
export const STAFF_PASSWORD_RESET = 'STAFF_PASSWORD_RESET';

/** Server-selected purpose only; never infer privileges from a submitted proof. */
export function passwordResetPurposeMatchesRole(proof: { purpose?: unknown }, role: string): boolean {
  return (role === 'CUSTOMER' && proof.purpose === CUSTOMER_PASSWORD_RESET)
    || (role === 'STAFF' && proof.purpose === STAFF_PASSWORD_RESET);
}
