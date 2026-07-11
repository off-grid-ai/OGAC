'use client';

import { Trash as Trash2 } from '@phosphor-icons/react/dist/ssr';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export function DeleteRowButton({ url, label }: Readonly<{ url: string; label: string }>) {
  const router = useRouter();

  async function del() {
    const res = await fetch(url, { method: 'DELETE' });
    if (res.ok) {
      toast.success(`${label} removed`);
      router.refresh();
    } else {
      toast.error('Delete failed');
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Delete ${label}`}
      onClick={del}
      className="text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="size-4" />
    </Button>
  );
}
