import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const error = searchParams.get('error');

    if (error) {
        return NextResponse.redirect(new URL('/login?error=access_denied', request.url));
    }

    if (!code) {
        return NextResponse.redirect(new URL('/login?error=no_code', request.url));
    }

    try {
        // Exchange code for token
        // Use 127.0.0.1 for server-to-server communication to avoid IPv6 resolution issues with localhost
        const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace('localhost', '127.0.0.1');
        const response = await fetch(`${apiUrl}/api/auth/github`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Backend auth failed:', response.status, errorText);
            throw new Error(`Authentication failed: ${response.status} ${errorText}`);
        }

        const data = await response.json();

        // Redirect with token in query param so client can save to localStorage
        return NextResponse.redirect(new URL(`/dashboard?token=${data.token}`, request.url));


    } catch (error) {
        console.error('OAuth callback error:', error);
        return NextResponse.redirect(new URL('/login?error=auth_failed', request.url));
    }
}
