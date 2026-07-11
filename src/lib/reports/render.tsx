// Branded, regulator-grade PDF renderer for a ReportDoc. SERVER-ONLY (react-pdf needs node). This is
// GLUE: it turns the validated, pure ReportDoc model into a professional, on-brand PDF — cover page,
// running header/footer, section hierarchy, real bordered tables that wrap across pages, status
// chips, callout bands, key/value grids and a signature block. It contains NO report DATA logic (that
// lives in build.ts) and NO completeness rules (validate.ts) — so it is excluded from unit coverage
// and proven instead by the build gate + the verify:reports harness (which extracts the PDF text and
// asserts the real data is present).
//
// Brand: Off Grid AI — emerald accent (the LIGHT #059669 for print legibility), near-black ink, a
// clean sans (react-pdf's built-in Helvetica — no external font fetch, deterministic on the server).
import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import type { JSX } from 'react';
import type {
  CalloutBlock,
  ControlStatus,
  KeyValuesBlock,
  ReportBlock,
  ReportDoc,
  ReportSection,
  StatusListBlock,
  TableBlock,
} from '@/lib/reports/model';
import { formatReportDate, recipientLabel } from '@/lib/reports/model';

// ── Brand tokens ─────────────────────────────────────────────────────────────────────────────────
const EMERALD = '#059669'; // light-mode accent — the print accent
const EMERALD_TINT = '#ECFDF5'; // callout/attest band + table header fill
const INK = '#0A0A0A';
const MUTED = '#525252';
const HAIRLINE = '#D4D4D4';
const ZEBRA = '#F5F5F5';
const RED = '#DC2626';
const AMBER = '#D97706';
const GREY = '#737373';

const styles = StyleSheet.create({
  page: {
    paddingTop: 64,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    color: INK,
    lineHeight: 1.4,
  },
  header: {
    position: 'absolute',
    top: 28,
    left: 48,
    right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 7.5,
    color: MUTED,
    borderBottomWidth: 0.75,
    borderBottomColor: HAIRLINE,
    paddingBottom: 6,
  },
  headerMarkRow: { flexDirection: 'row', alignItems: 'center' },
  headerMark: { width: 8, height: 8, backgroundColor: EMERALD, marginRight: 5 },
  footer: {
    position: 'absolute',
    bottom: 26,
    left: 48,
    right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: MUTED,
    borderTopWidth: 0.75,
    borderTopColor: HAIRLINE,
    paddingTop: 6,
  },
  sectionHeading: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 12.5,
    color: EMERALD,
    marginTop: 16,
    marginBottom: 7,
    paddingBottom: 3,
    borderBottomWidth: 1,
    borderBottomColor: EMERALD,
  },
  paragraph: { marginBottom: 6, textAlign: 'justify' },
  kvRow: { flexDirection: 'row', marginBottom: 2.5 },
  kvLabel: { width: '38%', color: MUTED },
  kvValue: { width: '62%', fontFamily: 'Helvetica-Bold' },
  table: { marginTop: 4, marginBottom: 8, borderWidth: 0.75, borderColor: HAIRLINE },
  tHeadRow: { flexDirection: 'row', backgroundColor: EMERALD_TINT },
  tRow: { flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: HAIRLINE },
  tRowZebra: { backgroundColor: ZEBRA },
  th: { fontFamily: 'Helvetica-Bold', fontSize: 8.5, color: INK, padding: 4 },
  td: { fontSize: 8.5, padding: 4, color: INK },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    paddingBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: HAIRLINE,
  },
  chip: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 6.5,
    color: '#FFFFFF',
    paddingVertical: 2,
    paddingHorizontal: 5,
    borderRadius: 2,
    width: 52,
    textAlign: 'center',
    marginRight: 8,
  },
  statusLabel: { flex: 1, fontFamily: 'Helvetica-Bold' },
  statusNote: { flex: 1.4, color: MUTED, fontSize: 8.5 },
  callout: {
    marginVertical: 6,
    padding: 8,
    backgroundColor: EMERALD_TINT,
    borderLeftWidth: 3,
    borderLeftColor: EMERALD,
  },
  calloutWarn: { backgroundColor: '#FEF3C7', borderLeftColor: AMBER },
  calloutInfo: { backgroundColor: '#F5F5F5', borderLeftColor: GREY },
  signature: { marginTop: 24, width: 260 },
  sigLine: { borderTopWidth: 0.75, borderTopColor: INK, marginBottom: 4, marginTop: 26 },
});

function chipColor(status: ControlStatus): string {
  if (status === 'pass') return EMERALD;
  if (status === 'fail') return RED;
  if (status === 'partial') return AMBER;
  return GREY;
}

function colWidth(count: number): string {
  return `${100 / count}%`;
}

function KeyValues({ block }: { block: KeyValuesBlock }): JSX.Element {
  return (
    <View style={{ marginBottom: 6 }}>
      {block.rows.map((r, i) => (
        <View key={i} style={styles.kvRow} wrap={false}>
          <Text style={styles.kvLabel}>{r.label}</Text>
          <Text style={styles.kvValue}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Table({ block }: { block: TableBlock }): JSX.Element {
  const w = colWidth(block.columns.length);
  return (
    <View style={styles.table}>
      <View style={styles.tHeadRow} fixed>
        {block.columns.map((c, i) => (
          <Text key={i} style={[styles.th, { width: w }]}>
            {c}
          </Text>
        ))}
      </View>
      {block.rows.map((row, ri) => (
        <View
          key={ri}
          style={ri % 2 === 1 ? [styles.tRow, styles.tRowZebra] : styles.tRow}
          wrap={false}
        >
          {row.map((cell, ci) => (
            <Text key={ci} style={[styles.td, { width: w }]}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function StatusList({ block }: { block: StatusListBlock }): JSX.Element {
  return (
    <View style={{ marginBottom: 6 }}>
      {block.items.map((it, i) => (
        <View key={i} style={styles.statusRow} wrap={false}>
          <Text style={[styles.chip, { backgroundColor: chipColor(it.status) }]}>
            {it.status.toUpperCase()}
          </Text>
          <Text style={styles.statusLabel}>{it.label}</Text>
          {it.note ? <Text style={styles.statusNote}>{it.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function Callout({ block }: { block: CalloutBlock }): JSX.Element {
  const extra =
    block.tone === 'warn'
      ? styles.calloutWarn
      : block.tone === 'info'
        ? styles.calloutInfo
        : undefined;
  return (
    <View style={extra ? [styles.callout, extra] : styles.callout} wrap={false}>
      <Text>{block.text}</Text>
    </View>
  );
}

function Block({ block }: { block: ReportBlock }): JSX.Element | null {
  switch (block.type) {
    case 'paragraph':
      return <Text style={styles.paragraph}>{block.text}</Text>;
    case 'callout':
      return <Callout block={block} />;
    case 'keyValues':
      return <KeyValues block={block} />;
    case 'table':
      return <Table block={block} />;
    case 'statusList':
      return <StatusList block={block} />;
    case 'signature':
      return (
        <View style={styles.signature} wrap={false}>
          <View style={styles.sigLine} />
          <Text style={{ fontFamily: 'Helvetica-Bold' }}>{block.name}</Text>
          <Text style={{ color: MUTED }}>{block.title}</Text>
        </View>
      );
  }
}

function Section({ section }: { section: ReportSection }): JSX.Element {
  return (
    <View>
      <Text style={styles.sectionHeading}>{section.heading}</Text>
      {section.blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </View>
  );
}

// ── Cover page ─────────────────────────────────────────────────────────────────────────────────
const cover = StyleSheet.create({
  page: { padding: 56, fontFamily: 'Helvetica', color: INK },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  mark: { width: 20, height: 20, backgroundColor: EMERALD, marginRight: 10 },
  wordmark: { fontFamily: 'Helvetica-Bold', fontSize: 15, color: INK },
  classification: {
    marginTop: 22,
    alignSelf: 'flex-start',
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    color: '#FFFFFF',
    backgroundColor: INK,
    paddingVertical: 3,
    paddingHorizontal: 8,
    letterSpacing: 1,
  },
  titleBlock: { marginTop: 120 },
  title: { fontFamily: 'Helvetica-Bold', fontSize: 30, color: INK, lineHeight: 1.15 },
  subtitle: { fontSize: 13, color: MUTED, marginTop: 8 },
  rule: { height: 3, width: 64, backgroundColor: EMERALD, marginTop: 20, marginBottom: 24 },
  tenant: { fontFamily: 'Helvetica-Bold', fontSize: 18, color: EMERALD },
  metaGrid: { marginTop: 40 },
  metaRow: { flexDirection: 'row', marginBottom: 6 },
  metaLabel: {
    width: 130,
    fontSize: 8,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaValue: { flex: 1, fontSize: 10, fontFamily: 'Helvetica-Bold', color: INK },
  provFoot: {
    position: 'absolute',
    left: 56,
    right: 56,
    bottom: 48,
    borderTopWidth: 0.75,
    borderTopColor: HAIRLINE,
    paddingTop: 8,
    fontSize: 6.5,
    color: MUTED,
    lineHeight: 1.5,
  },
});

function CoverMetaRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <View style={cover.metaRow}>
      <Text style={cover.metaLabel}>{label}</Text>
      <Text style={cover.metaValue}>{value}</Text>
    </View>
  );
}

function Cover({ doc }: { doc: ReportDoc }): JSX.Element {
  const m = doc.meta;
  const period = `${formatReportDate(m.period.from)} – ${formatReportDate(m.period.to)}`;
  return (
    <Page size="A4" style={cover.page}>
      <View style={cover.wordmarkRow}>
        <View style={cover.mark} />
        <Text style={cover.wordmark}>Off Grid AI Console</Text>
      </View>
      <Text style={cover.classification}>{m.classification.toUpperCase()}</Text>

      <View style={cover.titleBlock}>
        <Text style={cover.title}>{m.title}</Text>
        {m.subtitle ? <Text style={cover.subtitle}>{m.subtitle}</Text> : null}
        <View style={cover.rule} />
        <Text style={cover.tenant}>{m.tenantName}</Text>
      </View>

      <View style={cover.metaGrid}>
        {m.framework ? <CoverMetaRow label="Framework" value={m.framework} /> : null}
        <CoverMetaRow label="Reporting period" value={period} />
        <CoverMetaRow label="Prepared for" value={recipientLabel(m.recipient)} />
        <CoverMetaRow label="Generated" value={formatReportDate(m.generatedAt)} />
      </View>

      {m.provenance ? (
        <Text style={cover.provFoot}>
          Tamper-evident provenance — manifest {m.provenance.manifestId} · sha256{' '}
          {m.provenance.sha256} · signed by {m.provenance.signer}. Verify this artifact at
          /api/v1/admin/provenance/verify.
        </Text>
      ) : null}
    </Page>
  );
}

function ReportDocument({ doc }: { doc: ReportDoc }): JSX.Element {
  const m = doc.meta;
  const genDate = formatReportDate(m.generatedAt);
  return (
    <Document
      title={`${m.title} — ${m.tenantName}`}
      author="Off Grid AI Console"
      subject={m.framework ?? m.title}
      creator="offgrid-console"
      producer="offgrid-console"
    >
      <Cover doc={doc} />
      <Page size="A4" style={styles.page}>
        <View style={styles.header} fixed>
          <View style={styles.headerMarkRow}>
            <View style={styles.headerMark} />
            <Text>
              {m.title} · {m.tenantName}
            </Text>
          </View>
          <Text>{m.classification}</Text>
        </View>
        <View style={styles.footer} fixed>
          <Text>{m.classification}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          <Text>Generated {genDate}</Text>
        </View>
        {doc.sections.map((s, i) => (
          <Section key={i} section={s} />
        ))}
      </Page>
    </Document>
  );
}

/**
 * Render a validated ReportDoc to PDF bytes. The caller MUST validate the doc first
 * (validateReportDoc) — this renderer assumes a complete document and only lays it out.
 */
export async function renderReportDoc(doc: ReportDoc): Promise<Uint8Array> {
  const instance = pdf(<ReportDocument doc={doc} />);
  const buf = await instance.toBuffer();
  // toBuffer() returns a Node stream in v4; collect it into a single Uint8Array.
  if (buf instanceof Uint8Array) return buf;
  const chunks: Buffer[] = [];
  return new Promise<Uint8Array>((resolve, reject) => {
    const stream = buf as NodeJS.ReadableStream;
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    stream.on('error', reject);
  });
}
