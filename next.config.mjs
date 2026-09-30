/** @type {import('next').NextConfig} */
const nextConfig = {
  // O plano de validação builda em outra pasta (scripts/validacao/validar.sh
  // exporta NEXT_DIST_DIR=.next-validacao). Na mesma `.next`, o `next build`
  // da validação corrompia o `next dev` aberto: páginas sem CSS e código velho.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
