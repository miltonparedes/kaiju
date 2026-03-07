import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">Kaiju</h1>
      <p className="mt-4 text-lg text-gray-600">Divide, visualize, and share giant PRs</p>
    </main>
  );
}
