import NaoEncontrado from '@/components/NaoEncontrado'

export default function NotFound() {
  return <NaoEncontrado titulo="Nota fiscal não encontrada" voltarHref="/financeiro/notas-fiscais" voltarLabel="Ver as notas fiscais" />
}
