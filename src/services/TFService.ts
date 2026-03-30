import * as tf from "@tensorflow/tfjs-node";
import { getDailySaleReport } from "./ReportService";
import dayjs from "dayjs";

/**
 * Neural Network Service for Time-Series Sales Forecasting
 */
export const generateSalesForecast = async (daysToPredict: number = 14) => {
  try {
    // 1. Fetch Historical Data (Last 90 days)
    const to = dayjs().format("YYYY-MM-DD");
    const from = dayjs().subtract(90, "day").format("YYYY-MM-DD");
    
    const report = await getDailySaleReport(from, to, "Paid");
    const historicalDaily = report.summary.daily || [];

    if (historicalDaily.length < 7) {
      return { 
        success: false, 
        message: "Insufficient historical data for neural training (need at least 7 days)." 
      };
    }

    // Sort by date ascending for time-series
    const sortedData = [...historicalDaily].sort((a, b) => 
      dayjs(a.date).valueOf() - dayjs(b.date).valueOf()
    );

    const salesValues = sortedData.map(d => d.netSales);
    
    // 2. Preprocessing & Normalization
    const min = Math.min(...salesValues);
    const max = Math.max(...salesValues);
    const range = max - min || 1; // Prevent div by zero

    const normalizedSales = salesValues.map(v => (v - min) / range);

    // 3. Prepare Training Sets (Windowing)
    // We use a window of 7 days to predict the 8th
    const windowSize = 7;
    const inputs: number[][] = [];
    const labels: number[] = [];

    for (let i = 0; i < normalizedSales.length - windowSize; i++) {
      inputs.push(normalizedSales.slice(i, i + windowSize));
      labels.push(normalizedSales[i + windowSize]);
    }

    const xs = tf.tensor2d(inputs, [inputs.length, windowSize]);
    const ys = tf.tensor2d(labels, [labels.length, 1]);

    // 4. Build Model
    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 16, activation: 'relu', inputShape: [windowSize] }));
    model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1 }));

    model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

    // 5. Train
    console.log(`[TFService] Starting neural training with ${inputs.length} samples...`);
    const startTrain = Date.now();
    await model.fit(xs, ys, {
      epochs: 100,
      verbose: 0
    });
    const trainingTime = Date.now() - startTrain;
    console.log(`[TFService] Training complete in ${trainingTime}ms`);

    // 6. Predict Future
    let lastWindow = normalizedSales.slice(-windowSize);
    const predictions: { date: string, netSales: number, isForecast: boolean }[] = [];

    // Include last 7 days of actuals for context in the chart
    sortedData.slice(-7).forEach(d => {
      predictions.push({ date: d.date, netSales: d.netSales, isForecast: false });
    });

    let currentWindow = [...lastWindow];
    for (let i = 1; i <= daysToPredict; i++) {
      const inputTensor = tf.tensor2d([currentWindow], [1, windowSize]);
      const prediction = model.predict(inputTensor) as tf.Tensor;
      const normalizedPred = (await prediction.data())[0];
      
      // Denormalize
      const actualPred = (normalizedPred * range) + min;
      const predDate = dayjs(sortedData[sortedData.length - 1].date).add(i, "day").format("YYYY-MM-DD");

      predictions.push({
        date: predDate,
        netSales: Math.max(0, actualPred),
        isForecast: true
      });

      // Update window for next step
      currentWindow.push(normalizedPred);
      currentWindow.shift();
      
      inputTensor.dispose();
      prediction.dispose();
    }

    // Cleanup Tensors
    xs.dispose();
    ys.dispose();

    return {
      success: true,
      trainingTime,
      predictions,
      metrics: {
        min,
        max,
        dataPoints: historicalDaily.length
      }
    };

  } catch (error) {
    console.error("[TFService] Error:", error);
    throw error;
  }
};
