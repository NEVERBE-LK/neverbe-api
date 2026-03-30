import { NextResponse } from 'next/server';
import { adminFirestore } from '@/firebase/firebaseAdmin';

const SETTINGS_COLLECTION = "app_settings";
const DOC_ID = "neural_config";

export async function GET() {
  try {
    const doc = await adminFirestore.collection(SETTINGS_COLLECTION).doc(DOC_ID).get();
    
    // Default values if not set
    const defaultConfig = {
      historicalRunway: 120,
      forecastWindow: 14,
      weightingMode: 'BALANCED',
      lastUpdated: new Date().toISOString()
    };

    if (!doc.exists) {
      return NextResponse.json({ success: true, data: defaultConfig });
    }

    return NextResponse.json({ success: true, data: doc.data() });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { historicalRunway, forecastWindow, weightingMode } = body;

    const newConfig = {
      historicalRunway: Number(historicalRunway) || 120,
      forecastWindow: Number(forecastWindow) || 14,
      weightingMode: weightingMode || 'BALANCED',
      updatedAt: new Date().toISOString()
    };

    await adminFirestore.collection(SETTINGS_COLLECTION).doc(DOC_ID).set(newConfig, { merge: true });

    return NextResponse.json({ success: true, message: "Neural Configuration Synchronized" });
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
