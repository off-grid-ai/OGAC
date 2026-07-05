import { Image as ImageIcon } from '@phosphor-icons/react/dist/ssr';
import { ImageGenerator } from '@/components/images/ImageGenerator';
import { requireModuleForUser } from '@/lib/module-access';

export const dynamic = 'force-dynamic';

export default async function ImagesPage() {
  await requireModuleForUser('images');
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
          <ImageIcon className="size-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Image Studio</h1>
          <p className="text-sm text-muted-foreground">
            Generate images on your own hardware. Prompts and results stay on the box; images are
            saved to your storage.
          </p>
        </div>
      </div>
      <ImageGenerator />
    </div>
  );
}
