import Link from "next/link";

export default function NotFound() {
  return (
    <div className="py-16 text-center">
      <h1 className="font-display text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-muted">That page doesn’t exist, or you’re not signed in.</p>
      <Link href="/" className="btn mt-6">Back to the servers</Link>
    </div>
  );
}
