import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { updateClass } from "@/lib/classes.functions";
import { ClassThumb } from "@/components/ClassThumb";


const BUCKET = "class-thumbnails";

export function ClassThumbnailUploader({
  classId,
  currentUrl,
  onChange,
  size = "md",
}: {
  classId: string;
  currentUrl: string | null | undefined;
  onChange?: (url: string | null) => void;
  size?: "sm" | "md";
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
    <div className="flex items-center gap-3">

      <div className="flex flex-col gap-1">
        <Button type="button" size="sm" variant="outline" onClick={pick} disabled={busy}>
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ImagePlus className="mr-1 h-3 w-3" />}
          {currentUrl ? "변경" : "업로드"}
        </Button>
        {currentUrl && (
          <Button type="button" size="sm" variant="ghost" onClick={remove} disabled={busy}>
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
