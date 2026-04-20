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
  // 1. Z-Score Standardization (Robust to Outliers)
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / (values.length || 1)) || 1;

  const normalize = (v: number) => (v - mean) / stdDev;
  const denormalize = (v: number) => (v * stdDev) + mean;

  const dataset = values.map(normalize);
  
  // 2. Increase Window Size to capture 2 weeks of cyclical patterns
  const windowSize = historicalData.length >= 30 ? 14 : 7;
  
  // 3. Reshape for LSTM: [num_samples, timeSteps, features]
  const inputs: number[][][] = [];
  const labels: number[] = [];

  for (let i = 0; i < dataset.length - windowSize; i++) {
    // Input must be an array of arrays representing timesteps and features -> [[day1], [day2], ...]
    inputs.push(dataset.slice(i, i + windowSize).map(val => [val]));
    labels.push(dataset[i + windowSize]);
  }

  const xs = tf.tensor3d(inputs);
  const ys = tf.tensor2d(labels, [labels.length, 1]);

  // 4. LSTM Architecture
  const model = tf.sequential();
  model.add(tf.layers.lstm({ 
    units: 32, 
    inputShape: [windowSize, 1], 
    returnSequences: false 
  }));
  // Add dropout to prevent overfitting on noisy retail data
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: 16, activation: "relu" }));
  model.add(tf.layers.dense({ units: 1 }));

  model.compile({ optimizer: "adam", loss: "meanSquaredError" });

  const startTime = Date.now();
  // Train for more epochs as LSTM+Dropout manages overfitting better
  const history = await model.fit(xs, ys, { epochs: 150, verbose: 0 });
  const trainingDurationMs = Date.now() - startTime;
  const finalLoss = history.history.loss[history.history.loss.length - 1];

  console.info(`[TFService] Benchmarks: ${inputs.length} windows | ${trainingDurationMs}ms | Loss: ${Number(finalLoss).toFixed(6)}`);

  const predictions: any[] = [];
  // currentWindow starts as the last `windowSize` days, shaped as [[val1], [val2]...]
  let currentWindow = dataset.slice(-windowSize).map(v => [v]);
  const lastDate = new Date(historicalData[historicalData.length - 1].date);

  for (let i = 1; i <= daysToForecast; i++) {
    const inputTensor = tf.tensor3d([currentWindow]);
    const predTensor = model.predict(inputTensor) as tf.Tensor;
    const predValue = (await predTensor.data())[0];
    
    const nextDate = new Date(lastDate);
    nextDate.setDate(lastDate.getDate() + i);
    
    predictions.push({
      date: nextDate.toISOString().split("T")[0],
      netSales: Math.max(0, denormalize(predValue)),
      isForecast: true
    });

    // Slide the window forward: remove oldest day, append new prediction
    currentWindow = [...currentWindow.slice(1), [predValue]];
  }

  const avgForecastedDaily = predictions.reduce((acc, p) => acc + p.netSales, 0) / predictions.length;

  return {
    success: true,
    avgForecastedDaily,
    predictions: [
      ...historicalData.map(d => ({ ...d, isForecast: false })),
      ...predictions
    ],
    metrics: { 
      dataPoints: historicalData.length,
      trainingDurationMs,
      finalLoss: Number(finalLoss),
      windows: inputs.length
    }
  };
};
