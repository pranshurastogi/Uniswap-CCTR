"use client"

import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart } from "recharts"
import type { PricePoint } from "@/types"

interface RangeChartProps {
  data: PricePoint[]
}

export function RangeChart({ data }: RangeChartProps) {
  const chartData = data.map((point, index) => ({
    time: new Date(point.time).toLocaleTimeString(),
    tick: point.tick,
    center: point.center,
    upperBound: point.center + point.width / 2,
    lowerBound: point.center - point.width / 2,
    index,
  }))

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" fontSize={12} tick={{ fontSize: 10 }} />
          <YAxis fontSize={12} tick={{ fontSize: 10 }} />
          <Tooltip
            labelFormatter={(label) => `Time: ${label}`}
            formatter={(value: number, name: string) => [
              value.toFixed(0),
              name === "tick"
                ? "Current Price"
                : name === "center"
                  ? "Range Center"
                  : name === "upperBound"
                    ? "Upper Bound"
                    : "Lower Bound",
            ]}
          />

          {/* Range area */}
          <Area type="monotone" dataKey="upperBound" stackId="1" stroke="none" fill="rgba(59, 130, 246, 0.1)" />
          <Area type="monotone" dataKey="lowerBound" stackId="1" stroke="none" fill="rgba(255, 255, 255, 1)" />

          {/* Range boundaries */}
          <Line
            type="monotone"
            dataKey="upperBound"
            stroke="#3b82f6"
            strokeWidth={1}
            strokeDasharray="5 5"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="lowerBound"
            stroke="#3b82f6"
            strokeWidth={1}
            strokeDasharray="5 5"
            dot={false}
          />

          {/* Center line */}
          <Line
            type="monotone"
            dataKey="center"
            stroke="#1d4ed8"
            strokeWidth={2}
            dot={{ fill: "#1d4ed8", strokeWidth: 2, r: 3 }}
          />

          {/* Price line */}
          <Line
            type="monotone"
            dataKey="tick"
            stroke="#dc2626"
            strokeWidth={3}
            dot={{ fill: "#dc2626", strokeWidth: 2, r: 4 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
