import NaoEncontrado from '@/components/NaoEncontrado'

/** notFound() dentro do app sem tela própria de "não encontrado": volta ao início. */
export default function NotFound() {
  return <NaoEncontrado titulo="Página não encontrada" voltarHref="/" voltarLabel="Voltar ao início" />
}
