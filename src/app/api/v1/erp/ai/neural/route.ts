import { NextResponse } from 'next/server';
import { getCache } from '@/services/CacheService';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const refresh = searchParams.get('refresh') === 'true';

  try {
    // 1. Unified Neural Core strictly reads from the synchronized Cloud Cache
    // Training is handled by background Cloud Functions for performance.
    const cached = await getCache("neural_core_feed");
    
    if (cached) {
      return NextResponse.json({ success: true, data: cached });
    }

    return NextResponse.json({ 
      success: false, 
      message: "Neural Core is currently synchronizing global metrics. Please check back in a moment." 
    }, { status: 404 });

  } catch (error: any) {
    console.error("[NeuralREST] Read error:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
