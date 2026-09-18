export const config = {
  matcher: '/((?!_vercel).*)',
};

export default function middleware(request) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;

  // Basic Auth is opt-in: if either credential isn't configured, skip the
  // check instead of locking everyone out with no way to log in.
  if (!user || !pass) return;

  const auth = request.headers.get('authorization');
  if (auth) {
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [reqUser, reqPass] = atob(encoded).split(':');
      if (reqUser === user && reqPass === pass) {
        return;
      }
    }
  }

  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="BBQ AYCE Waitlist"' },
  });
}
