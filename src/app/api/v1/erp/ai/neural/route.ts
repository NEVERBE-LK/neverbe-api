import { NextResponse } from 'next/server';
import * as NeuralHubService from '@/services/NeuralHubService';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get('refresh') === 'true';

  try {
    // 1. If refresh is requested, signal background synchronization
    if (refresh) {
       console.log("[NeuralREST] Triggering Neural Force Sync (Cloud Functions Integration)");
       await NeuralHubService.forceSyncNeuralCore();
    }

    // 2. Return pre-calculated feed from Firestore (synced with Background Jobs)
    const feed = await NeuralHubService.getNeuralFeed();

    return NextResponse.json(feed);

  } catch (error: any) {
    console.error("[NeuralREST] Read error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
