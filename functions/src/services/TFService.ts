import * as tf from "@tensorflow/tfjs";
import { HistoricalPoint } from "./DataService";

export const generateSalesForecast = async (
  daysToForecast: number = 14,
  historicalData: HistoricalPoint[]
) => {
  if (historicalData.length < 7) {
    return { success: false, message: "Insufficient historical data for neural training (need at least 7 days)." };
  }

  const values = historicalData.map(d => d.netSales);
  
  // 🛡️ RECENT NOISE GATE: If the last 30 days are zero, force a zero forecast.
  // This prevents historical 'ghost' orders from influencing the current trend.
  const recent30Days = values.slice(-30);
  const recentSales = recent30Days.reduce((a, b) => a + b, 0);

  if (recentSales === 0) {
    const lastDate = new Date(historicalData[historicalData.length - 1].date);
    const predictions = Array.from({ length: daysToForecast }, (_, i) => {
        const nextDate = new Date(lastDate);
        nextDate.setDate(lastDate.getDate() + (i + 1));
        return {
            date: nextDate.toISOString().split("T")[0],
            netSales: 0,
            isForecast: true
        };
    });

    return {
        success: true,
        avgForecastedDaily: 0,
        predictions: [
          ...historicalData.map(d => ({ ...d, isForecast: false })),
          ...predictions
        ],
        metrics: { dataPoints: historicalData.length, noiseGateActive: true }
    };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = (max - min) || 1;

  const normalize = (v: number) => (v - min) / range;
  const denormalize = (v: number) => (v * range) + min;

  const dataset = values.map(normalize);
  const windowSize = 7;
  const inputs: number[][] = [];
  const labels: number[] = [];

  for (let i = 0; i < dataset.length - windowSize; i++) {
    inputs.push(dataset.slice(i, i + windowSize));
    labels.push(dataset[i + windowSize]);
  }

  const xs = tf.tensor2d(inputs);
  const ys = tf.tensor2d(labels, [labels.length, 1]);

  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 16, activation: "relu", inputShape: [windowSize] }));
  model.add(tf.layers.dense({ units: 8, activation: "relu" }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({ optimizer: "adam", loss: "meanSquaredError" });

  await model.fit(xs, ys, { epochs: 100, verbose: 0 });

  const predictions: any[] = [];
  let currentWindow = dataset.slice(-windowSize);
  const lastDate = new Date(historicalData[historicalData.length - 1].date);

  for (let i = 1; i <= daysToForecast; i++) {
    const inputTensor = tf.tensor2d([currentWindow]);
    const predTensor = model.predict(inputTensor) as tf.Tensor;
    const predValue = (await predTensor.data())[0];
    
    const nextDate = new Date(lastDate);
    nextDate.setDate(lastDate.getDate() + i);
    
    predictions.push({
      date: nextDate.toISOString().split("T")[0],
      netSales: Math.max(0, denormalize(predValue)),
      isForecast: true
    });

    currentWindow = [...currentWindow.slice(1), predValue];
  }

  const avgForecastedDaily = predictions.reduce((acc, p) => acc + p.netSales, 0) / predictions.length;

  return {
    success: true,
    avgForecastedDaily,
    predictions: [
      ...historicalData.map(d => ({ ...d, isForecast: false })),
      ...predictions
    ],
    metrics: { dataPoints: historicalData.length }
  };
};
