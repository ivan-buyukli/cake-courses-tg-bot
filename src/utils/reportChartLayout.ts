import { max as d3Max } from "d3-array";
import { scaleBand, scaleLinear } from "d3-scale";

export interface BarDatum {
  key: string;
  value: number;
}

export interface BarLayout {
  key: string;
  value: number;
  x: number;
  centerX: number;
  width: number;
  height: number;
  topY: number;
}

export interface BarChartLayout {
  bars: BarLayout[];
  gap: number;
  heightForValue: (value: number) => number;
}

export function createBarChartLayout(
  data: BarDatum[],
  options: {
    x: number;
    y: number;
    width: number;
    height: number;
    minBarWidth: number;
    maxBarWidth: number;
    minBarHeight: number;
  },
): BarChartLayout {
  const domain = data.map((item) => item.key);
  const xScale = scaleBand<string>()
    .domain(domain)
    .range([options.x, options.x + options.width])
    .paddingInner(0.16)
    .paddingOuter(0.08);
  const maxValue = d3Max(data, (item) => item.value) ?? 0;
  const yScale = scaleLinear()
    .domain([0, Math.max(maxValue, 1)])
    .range([0, options.height]);
  const scaledWidth = xScale.bandwidth();
  const barWidth = clamp(
    scaledWidth,
    Math.min(options.minBarWidth, scaledWidth),
    options.maxBarWidth,
  );

  const heightForValue = (value: number) => {
    if (value <= 0) return 0;
    return Math.max(options.minBarHeight, yScale(value));
  };

  const bars = data.map((item) => {
    const bandX = xScale(item.key) ?? options.x;
    const x = bandX + (scaledWidth - barWidth) / 2;
    const height = heightForValue(item.value);

    return {
      key: item.key,
      value: item.value,
      x: roundChartNumber(x),
      centerX: roundChartNumber(x + barWidth / 2),
      width: roundChartNumber(barWidth),
      height,
      topY: options.y + options.height - height,
    };
  });

  return {
    bars,
    gap: Math.max(0, Math.floor(xScale.step() - barWidth)),
    heightForValue,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundChartNumber(value: number): number {
  return Number(value.toFixed(1));
}
