import { NextRequest, NextResponse } from 'next/server';
import { blastStorage } from '@/lib/services/blastStorage';

/**
 * Public Unsubscribe API Route
 * Compliant with RFC 8058 One-Click Unsubscribe (POST) and standard link unsubscribe (GET)
 */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || url.searchParams.get('recipient') || '';
    
    // Also parse body if provided
    let email = token;
    try {
      const body = await req.json();
      if (body.email) email = body.email;
    } catch {
      // Body might be empty or form-encoded
    }

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email address or token required' }, { status: 400 });
    }

    await blastStorage.addSuppression(email, 'User unsubscribed via One-Click List-Unsubscribe');

    return NextResponse.json({
      success: true,
      message: `${email} has been permanently suppressed from future emails.`,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to process unsubscribe' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || url.searchParams.get('recipient') || '';

    if (!token || !token.includes('@')) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    await blastStorage.addSuppression(token, 'User unsubscribed via link');

    return NextResponse.json({
      success: true,
      unsubscribed: token,
      message: 'Successfully unsubscribed from future communications.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
