import { Image, renderToBuffer, Text, View } from "@react-pdf/renderer";
import { type Brand, BrandedDocument, styles } from "./branded";

// The inspection report (Rental Housing Act s5; D120), branded for the agency.

export interface InspectionReportData {
  title: string;
  dwelling: string;
  eftReference: string;
  tenants: string[];
  inspectedOn: string;
  attendees: string | null;
  notes: string | null;
  completedOn: string;
  outgoing: boolean;
  rooms: {
    room: string;
    items: { item: string; condition: string; notes: string | null; ingoing: string | null; worse: boolean }[];
  }[];
  photos: { caption: string; data: Buffer; format: "png" | "jpg" }[];
}

const s = {
  room: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  row: { flexDirection: "row" as const, borderBottomWidth: 0.5, borderBottomColor: "#dddddd", paddingVertical: 3 },
  worse: { color: "#b91c1c", fontFamily: "Helvetica-Bold" },
  photos: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, marginTop: 8 },
  photo: { width: 160, marginBottom: 8 },
  img: { width: 160, height: 120, objectFit: "cover" as const },
};

function Report({ brand, r }: { brand: Brand; r: InspectionReportData }) {
  const w = r.outgoing ? { item: "26%", cond: "16%", in: "16%", notes: "42%" } : { item: "30%", cond: "18%", in: "0%", notes: "52%" };
  return (
    <BrandedDocument brand={brand} title={r.title}>
      <Text style={styles.title}>{r.title}</Text>
      <Text style={styles.subtitle}>
        {r.eftReference} · inspected on {r.inspectedOn} · completed on {r.completedOn}
      </Text>
      <Text style={styles.label}>Dwelling</Text>
      <Text style={styles.value}>{r.dwelling}</Text>
      <Text style={styles.label}>Tenant{r.tenants.length === 1 ? "" : "s"}</Text>
      <Text style={styles.value}>{r.tenants.join(", ")}</Text>
      {r.attendees ? (
        <>
          <Text style={styles.label}>Present</Text>
          <Text style={styles.value}>{r.attendees}</Text>
        </>
      ) : null}
      {r.notes ? (
        <>
          <Text style={styles.label}>General notes</Text>
          <Text style={styles.value}>{r.notes}</Text>
        </>
      ) : null}
      {r.outgoing ? (
        <Text style={[styles.muted, { fontSize: 8, marginBottom: 4 }]}>Items in red are in a worse condition than at the ingoing inspection.</Text>
      ) : null}
      {r.rooms.map((room) => {
        const row = (i: (typeof room.items)[number]) => (
          <View key={i.item} style={s.row} wrap={false}>
            <Text style={{ width: w.item }}>{i.item}</Text>
            <Text style={[{ width: w.cond }, i.worse ? s.worse : {}]}>{i.condition}</Text>
            {r.outgoing ? <Text style={{ width: w.in }}>{i.ingoing ?? ""}</Text> : null}
            <Text style={{ width: w.notes }}>{i.notes ?? ""}</Text>
          </View>
        );
        return (
          <View key={room.room}>
            {/* The room's heading never sits alone at the foot of a page */}
            <View wrap={false}>
              <Text style={s.room}>{room.room}</Text>
              <View style={[styles.headRow, { fontSize: 8 }]}>
                <Text style={{ width: w.item }}>Item</Text>
                <Text style={{ width: w.cond }}>Condition</Text>
                {r.outgoing ? <Text style={{ width: w.in }}>At move-in</Text> : null}
                <Text style={{ width: w.notes }}>Notes</Text>
              </View>
              {room.items.slice(0, 2).map(row)}
            </View>
            {room.items.slice(2).map(row)}
          </View>
        );
      })}
      {r.photos.length ? (
        <View break>
          <Text style={s.room}>Photos</Text>
          <View style={s.photos}>
            {r.photos.map((p, i) => (
              <View key={`${p.caption}-${i}`} style={s.photo} wrap={false}>
                <Image src={{ data: p.data, format: p.format }} style={s.img} />
                <Text style={{ fontSize: 7 }}>{p.caption}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </BrandedDocument>
  );
}

export const renderInspectionReport = (brand: Brand, r: InspectionReportData) => renderToBuffer(<Report brand={brand} r={r} />);
