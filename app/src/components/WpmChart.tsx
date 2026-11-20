import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import type { Segment } from "@/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatClock, paceFromWpm } from "@/format";
import { useI18n } from "@/i18n/I18nProvider";

const FILL = { slow: "var(--chart-4)", normal: "var(--chart-2)", fast: "var(--chart-1)" };

export default function WpmChart({
  segments,
  activeIndex,
  onSeek,
}: {
  segments: Segment[];
  activeIndex: number;
  onSeek: (ms: number) => void;
}) {
  const { dict } = useI18n();
  const data = segments.map((segment, index) => ({
    index,
    time: formatClock(segment.start_ms),
    start_ms: segment.start_ms,
    wpm: Math.round(segment.wpm),
    pace: paceFromWpm(segment.wpm),
  }));
  const config = {
    wpm: { label: dict.detail.speed, color: "var(--chart-2)" },
  } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{dict.detail.chartTitle}</CardTitle>
        <CardDescription>{dict.detail.chartHint}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <BarChart data={data}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="time" tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tickLine={false} axisLine={false} width={32} />
            <ReferenceLine y={110} stroke="var(--border)" strokeDasharray="3 3" />
            <ReferenceLine y={160} stroke="var(--border)" strokeDasharray="3 3" />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="wpm"
              radius={4}
              className="cursor-pointer"
              onClick={(item) => {
                const row = item as { start_ms?: number; payload?: { start_ms?: number } };
                const ms = row.start_ms ?? row.payload?.start_ms;
                if (ms != null) onSeek(ms);
              }}
            >
              {data.map((row) => (
                <Cell
                  key={row.index}
                  fill={FILL[row.pace]}
                  stroke={row.index === activeIndex ? "var(--foreground)" : "transparent"}
                  strokeWidth={row.index === activeIndex ? 2 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
