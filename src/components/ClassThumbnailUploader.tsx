import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { updateClass } from "@/lib/classes.functions";
import { ClassThumb } from "@/components/ClassThumb";
import { cn } from "@/lib/utils";

const BUCKET = "class-thumbnails";

export function ClassThumbnailUploader({
  classId,
  currentUrl,
  onChange,
  size = "md",
  className,
}: {
  classId: string;
  currentUrl: string | null | undefined;
  onChange?: (url: string | null) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const dims = size === "sm" ? "h-14 w-24" : "h-24 w-40";

  const pick = () => inputRef.current?.click();

  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("이미지 파일만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("5MB 이하 이미지를 사용하세요.");
      return;
    }
    setBusy(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${classId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
      await updateClass({ data: { id: classId, thumbnail_url: path } });
      toast.success("썸네일이 저장되었습니다.");
      onChange?.(signed?.signedUrl ?? path);

    } catch (err: any) {
      toast.error(err.message ?? "업로드 실패");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    if (!currentUrl) return;
    if (!confirm("썸네일을 제거하시겠습니까?")) return;
    setBusy(true);
    try {
      await updateClass({ data: { id: classId, thumbnail_url: null } });
      onChange?.(null);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-md bg-muted",
        dims,
        className
      )}
    >
      {currentUrl ? (
        <ClassThumb
          src={currentUrl}
          alt="수강반 썸네일"
          className="h-full w-full object-cover transition group-hover:opacity-75"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImagePlus className={size === "sm" ? "h-6 w-6" : "h-8 w-8"} />
        </div>
      )}

      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 opacity-0 transition group-hover:opacity-100">
        <Button type="button" size="sm" variant="secondary" onClick={pick} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <ImagePlus className="mr-1 h-3 w-3" />
          )}
          {currentUrl ? "변경" : "업로드"}
        </Button>
        {currentUrl && (
          <Button type="button" size="sm" variant="destructive" onClick={remove} disabled={busy}>
            <Trash2 className="mr-1 h-3 w-3" /> 제거
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
    </div>
  );
}
