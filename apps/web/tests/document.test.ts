// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { isArtifactId, previewOf } from '../src/screens/document/Document.tsx'

describe('страница документа', () => {
  it('на странице показываются только безопасные виды (PDF — рисунком pdf.js, DOCX и XLSX — текстом и таблицей); HTML, SVG и прочее — скачать или открыть в песочнице', () => {
    expect(previewOf('text/markdown; charset=utf-8')).toBe('markdown')
    expect(previewOf('application/octet-stream', 'notes.md')).toBe('markdown')
    expect(previewOf('application/json')).toBe('json')
    expect(previewOf('application/vnd.agent+json')).toBe('json')
    expect(previewOf('text/plain')).toBe('text')
    expect(previewOf('image/png')).toBe('image')
    expect(previewOf('image/svg+xml')).toBe('none')
    expect(previewOf('text/html')).toBe('none')
    expect(previewOf('application/pdf')).toBe('pdf')
    expect(previewOf('application/octet-stream', 'Счёт.PDF')).toBe('pdf')
    expect(previewOf('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('docx')
    expect(previewOf('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('xlsx')
    expect(previewOf('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('pptx')
    expect(previewOf('application/octet-stream', 'Защита.PPTX')).toBe('pptx')
    expect(previewOf('application/zip', 'Акт.DOCX')).toBe('docx')
    expect(previewOf('application/msword', 'old.doc')).toBe('none')
    expect(previewOf(null)).toBe('none')
  })

  it('адрес документа — только id артефакта', () => {
    expect(isArtifactId('da763707-b3f7-4a7c-a3f3-fed55a3ff9b9')).toBe(true)
    expect(isArtifactId('../tasks')).toBe(false)
  })
})

// Word-документ «с подвохом»: то, что вернул бы mammoth из враждебного DOCX.
vi.mock('mammoth', () => ({
  convertToHtml: async () => ({ value: '<h1>Акт</h1><p onclick="x()">Текст <a href="javascript:alert(1)">плохая</a> <a href="https://example.org">хорошая</a></p><script>alert(1)</script><img src="https://evil/x.png"><img src="data:image/png;base64,AAA="><style>p{}</style>', messages: [] }),
}))

describe('офисные документы', () => {
  it('HTML документа Word: без скриптов, стилей и событий; ссылки — внешние в новую вкладку; заголовки — на уровень ниже', async () => {
    const { docxHtml } = await import('../src/screens/document/OfficePreview.tsx')
    const html = await docxHtml(new ArrayBuffer(0))
    expect(html).toContain('<h2>Акт</h2>')
    expect(html).not.toMatch(/script|onclick|<style|javascript:|evil/)
    expect(html).toContain('<a href="https://example.org" target="_blank" rel="noopener noreferrer">хорошая</a>')
    expect(html).toContain('плохая')
    expect(html).toContain('src="data:image/png;base64,AAA="')
  })

  it('ячейка таблицы: число с разрядами, дата днём, пусто — пусто', async () => {
    const { cellText } = await import('../src/screens/document/OfficePreview.tsx')
    expect(cellText(184500, 'ru-RU')).toBe((184500).toLocaleString('ru-RU'))
    expect(cellText(null, 'ru-RU')).toBe('')
    expect(cellText('АО «Вектор»', 'ru-RU')).toBe('АО «Вектор»')
    expect(cellText(new Date(2026, 9, 3), 'ru-RU')).toBe(new Date(2026, 9, 3).toLocaleDateString('ru-RU'))
  })
})

describe('поиск в PDF', () => {
  it('регистр, пробелы и «ё» не важны; совпадения без пересечений', async () => {
    const { countMatches, fold, lineMatches, pageText } = await import('../src/screens/document/PdfPreview.tsx')
    expect(fold('  Счёт   №430 ')).toBe('счет №430')
    expect(countMatches('Счёт №430, счет-фактура к СЧЕТУ', 'счет')).toBe(3)
    expect(countMatches('aaaa', 'aa')).toBe(2)
    expect(countMatches('что угодно', ' ')).toBe(0)
    expect(pageText({ items: [{ str: 'Invoice' }, {}, { str: 'No. 430' }] })).toBe('Invoice  No. 430')
    expect(lineMatches(['Счёт №430, СЧЕТ'], 'счет')).toEqual([[[0, 4, 0], [11, 15, 1]]])
    expect(lineMatches(['abc'], '  ')).toEqual([[]])
  })

  it('совпадение, разорванное переносом строки, подсвечивается кусками в обеих строках', async () => {
    const { lineMatches } = await import('../src/screens/document/PdfPreview.tsx')
    // «Альфа-Снаб» на конце строки, «184 500» — в начале следующей.
    expect(lineMatches(['Поставщик ООО «Альфа-Снаб», сумма', '184 500 ₽'], 'сумма 184')).toEqual([[[28, 33, 0]], [[0, 3, 0]]])
    // Лишние пробелы в конце строки и в запросе не мешают; номер совпадения — сквозной по странице.
    expect(lineMatches(['счёт  ', ' №430 и счет', '№431'], 'счет №43')).toEqual([[[0, 4, 0]], [[1, 4, 0], [8, 12, 1]], [[0, 3, 1]]])
  })
})

describe('презентация PPTX', () => {
  it('слайды по порядку presentation.xml, заголовок — плейсхолдер title, абзацы — по порядку', async () => {
    const { samplePptx } = await import('../../devstack/src/office.ts')
    const { pptxSlides } = await import('../src/screens/document/OfficePreview.tsx')
    const file = samplePptx([
      { title: 'Заявка', lines: ['ООО «Полярис»'] },
      { title: 'Почему мы', lines: ['Лицензия', '12 объектов'] },
    ])
    const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer
    expect(await pptxSlides(data)).toEqual([
      { title: 'Заявка', lines: ['ООО «Полярис»'] },
      { title: 'Почему мы', lines: ['Лицензия', '12 объектов'] },
    ])
  })

  it('не презентация — отказ, а не пустой список', async () => {
    const { sampleDocx } = await import('../../devstack/src/office.ts')
    const { pptxSlides } = await import('../src/screens/document/OfficePreview.tsx')
    const file = sampleDocx(['текст'])
    await expect(pptxSlides(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer)).rejects.toThrow('not_a_presentation')
  })
})
