function validatePasswordStrength(password) {
  const errors = [];
  if (typeof password !== 'string') return ['Invalid password.'];
  if (password.length < 8) errors.push('at least 8 characters');
  if (!/[a-z]/.test(password)) errors.push('a lowercase letter');
  if (!/[A-Z]/.test(password)) errors.push('an uppercase letter');
  if (!/[0-9]/.test(password)) errors.push('a number');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\|,.<>\/?]/.test(password)) errors.push('a symbol');
  return errors;
}

module.exports = { validatePasswordStrength };
