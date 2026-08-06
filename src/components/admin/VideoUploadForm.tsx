import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as tus from "tus-js-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload as UploadIcon, Youtube, ImagePlus, Folder, FolderOpen, X } from "lucide-react";

type FolderNode = { id: string; name: string; depth: number };

function buildFolderTree(list: any[]): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (parentId: string | null, depth: number) => {
    list
      .filter((f) => (f.parent_folder_id ?? null) === parentId)
      .forEach((f) => {
        out.push({ id: f.id, name: f.name, depth });
        walk(f.id, depth + 1);
      });
  };
  walk(null, 0);
  // 부모가 목록에 없는 폴더도 누락되지 않게 보완
  for (const f of list) {
    if (!out.some((o) => o.id === f.id)) out.push({ id: f.id, name: f.name, depth: 0 });
  }
  return out;
}
import { createVimeoUpload, finalizeVideo, addYoutubeVideo } from "@/lib/vimeo.functions";
import { listClasses, listClassFolders, updateVideo } from "@/lib/classes.functions";
import { useAdminRole } from "@/components/AdminRole";
import { supabase } from "@/integrations/supabase/client";

const THUMB_BUCKET = "video-thumbnails";

async function uploadThumbnail(videoId: string, file: File) {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${videoId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from(THUMB_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  await updateVideo({ data: { id: videoId, thumbnail_url: path } });
}

function ThumbnailPicker({
  id,
  file,
  onChange,
}: {
  id: string;
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const pick = (f: File | null) => {
    if (f) {
      if (!f.type.startsWith("image/")) {
        toast.error("이미지 파일만 업로드할 수 있습니다.");
        return;
      }
      if (f.size > 5 * 1024 * 1024) {
        toast.error("5MB 이하 이미지를 사용하세요.");
        return;
      }
      setPreview(URL.createObjectURL(f));
    } else {
      setPreview(null);
    }
    onChange(f);
  };

  return (
    <div>
      <Label>썸네일 (선택 사항)</Label>
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <input
          id={`${id}-thumb`}
          ref={ref}
          type="file"
          accept="image/*"
          className="absolute h-0 w-0 opacity-0"
          tabIndex={-1}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />

        {preview && (
          <img
            src={preview}
            alt="썸네일 미리보기"
            className="h-16 w-28 rounded-md border object-cover"
          />
        )}
        <Button type="button" variant="secondary" onClick={() => ref.current?.click()}>
          <ImagePlus className="mr-1.5 h-4 w-4" />
          {file ? "썸네일 변경" : "썸네일 선택"}
        </Button>
        {file ? (
          <>
            <span className="rounded-md bg-muted px-2.5 py-1 text-sm text-muted-foreground">
              {file.name}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                pick(null);
                if (ref.current) ref.current.value = "";
              }}
            >
              제거
            </Button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            미지정 시 영상 기본 썸네일이 사용됩니다.
          </span>
        )}
      </div>
    </div>
  );
}

const NO_CLASS = "__none__";
const NO_FOLDER = "__none__";

const RATES = [1, 1.25, 1.5, 1.75, 2];

type Playback = {
  allow_seek: boolean;
  max_playback_rate: number;
  completion_ratio: number;
  rewatch_allow_seek: boolean | null;
  rewatch_max_playback_rate: number | null;
};

const DEFAULT_PLAYBACK: Playback = {
  allow_seek: false,
  max_playback_rate: 1,
  completion_ratio: 1,
  rewatch_allow_seek: null,
  rewatch_max_playback_rate: null,
};

function PlaybackSettings({
  id,
  value,
  onChange,
}: {
  id: string;
  value: Playback;
  onChange: (v: Playback) => void;
}) {
  const set = (p: Partial<Playback>) => onChange({ ...value, ...p });
  return (
    <div className="space-y-4 rounded-lg border p-4">
      <p className="text-sm font-medium">재생 설정</p>

      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground">최초 시청</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-2">
            <Switch
              id={`${id}-seek`}
              checked={value.allow_seek}
              onCheckedChange={(v) => set({ allow_seek: v })}
            />
            <Label htmlFor={`${id}-seek`}>건너뛰기 허용</Label>
          </div>
          <div>
            <Label>최대 배속</Label>
            <Select
              value={String(value.max_playback_rate)}
              onValueChange={(v) => set({ max_playback_rate: Number(v) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RATES.map((r) => (
                  <SelectItem key={r} value={String(r)}>{r}x</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>수강 완료 기준</Label>
            <Select
              value={String(Math.round(value.completion_ratio * 100))}
              onValueChange={(v) => set({ completion_ratio: Number(v) / 100 })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[50, 60, 70, 80, 90, 95, 100].map((p) => (
                  <SelectItem key={p} value={String(p)}>{p}%</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="space-y-3 border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground">
          재시청 (미설정 시 최초 시청 설정을 따름)
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-2">
            <Switch
              id={`${id}-rseek`}
              checked={value.rewatch_allow_seek ?? value.allow_seek}
              onCheckedChange={(v) => set({ rewatch_allow_seek: v })}
            />
            <Label htmlFor={`${id}-rseek`}>건너뛰기 허용</Label>
            {value.rewatch_allow_seek !== null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set({ rewatch_allow_seek: null })}
              >
                초기화
              </Button>
            )}
          </div>
          <div>
            <Label>최대 배속</Label>
            <div className="flex items-center gap-1">
              <Select
                value={String(value.rewatch_max_playback_rate ?? value.max_playback_rate)}
                onValueChange={(v) => set({ rewatch_max_playback_rate: Number(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RATES.map((r) => (
                    <SelectItem key={r} value={String(r)}>{r}x</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {value.rewatch_max_playback_rate !== null && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => set({ rewatch_max_playback_rate: null })}
                >
                  초기화
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


export function VideoUploadForm({ onUploaded }: { onUploaded?: () => void }) {
  const { isAdmin, isInstructor } = useAdminRole();
  const { data: classes = [] } = useQuery({
    queryKey: ["admin", "classes"],
    queryFn: () => listClasses(),
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [classId, setClassId] = useState<string>(NO_CLASS);
  const [folderId, setFolderId] = useState<string>(NO_FOLDER);
  const [isPublished, setIsPublished] = useState(false);
  const [sortOrder, setSortOrder] = useState<number>(0);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [playback, setPlayback] = useState<Playback>(DEFAULT_PLAYBACK);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [ytThumbFile, setYtThumbFile] = useState<File | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const [ytUrl, setYtUrl] = useState("");
  const [ytTitle, setYtTitle] = useState("");
  const [ytDesc, setYtDesc] = useState("");
  const [ytClassId, setYtClassId] = useState<string>(NO_CLASS);
  const [ytFolderId, setYtFolderId] = useState<string>(NO_FOLDER);
  const [ytPublished, setYtPublished] = useState(false);
  const [ytSort, setYtSort] = useState<number>(0);
  const [ytSaving, setYtSaving] = useState(false);
  const [ytPlayback, setYtPlayback] = useState<Playback>(DEFAULT_PLAYBACK);

  const { data: folders = [] } = useQuery({
    queryKey: ["admin", "class-folders", classId],
    queryFn: () => listClassFolders({ data: { classId } }),
    enabled: classId !== NO_CLASS,
  });
  const { data: ytFolders = [] } = useQuery({
    queryKey: ["admin", "class-folders", ytClassId],
    queryFn: () => listClassFolders({ data: { classId: ytClassId } }),
    enabled: ytClassId !== NO_CLASS,
  });

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return toast.error("파일을 선택하세요.");
    if (!title.trim()) return toast.error("제목을 입력하세요.");

    setUploading(true);
    setProgress(0);
    try {
      const session = await createVimeoUpload({
        data: { name: title, description: description || null, size: file.size },
      });

      await new Promise<void>((resolve, reject) => {
        const up = new tus.Upload(file, {
          endpoint: session.uploadLink,
          uploadUrl: session.uploadLink,
          retryDelays: [0, 1000, 3000, 5000],
          chunkSize: 128 * 1024 * 1024,
          metadata: { filename: file.name, filetype: file.type },
          headers: {},
          onError: (err) => reject(err),
          onProgress: (sent, total) => setProgress(Math.round((sent / total) * 100)),
          onSuccess: () => resolve(),
        });
        up.start();
      });

      const row: any = await finalizeVideo({
        data: {
          uri: session.uri,
          title,
          description: description || null,
          class_id: classId === NO_CLASS ? null : classId,
          folder_id: classId === NO_CLASS || folderId === NO_FOLDER ? null : folderId,
          is_published: isPublished,
          sort_order: sortOrder,
          ...playback,
        },
      });

      if (thumbFile && row?.id) {
        try {
          await uploadThumbnail(row.id, thumbFile);
        } catch (err: any) {
          toast.error(`썸네일 저장 실패: ${err.message ?? ""}`);
        }
      }

      toast.success("업로드 완료! Vimeo 처리 후 자동으로 재생 가능합니다.");
      setTitle("");
      setDescription("");
      setClassId(NO_CLASS);
      setFolderId(NO_FOLDER);
      setIsPublished(false);
      setSortOrder(0);
      setPlayback(DEFAULT_PLAYBACK);
      setFile(null);
      setThumbFile(null);
      setResetKey((k) => k + 1);
      if (fileRef.current) fileRef.current.value = "";
      setProgress(null);
      onUploaded?.();
    } catch (err: any) {
      toast.error(err.message ?? "업로드 실패");
    } finally {
      setUploading(false);
    }
  };

  const addYt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ytUrl.trim()) return toast.error("YouTube 링크를 입력하세요.");
    if (!ytTitle.trim()) return toast.error("제목을 입력하세요.");
    setYtSaving(true);
    try {
      const row: any = await addYoutubeVideo({
        data: {
          url: ytUrl.trim(),
          title: ytTitle,
          description: ytDesc || null,
          class_id: ytClassId === NO_CLASS ? null : ytClassId,
          folder_id: ytClassId === NO_CLASS || ytFolderId === NO_FOLDER ? null : ytFolderId,
          is_published: ytPublished,
          sort_order: ytSort,
          ...ytPlayback,
        },
      });
      if (ytThumbFile && row?.id) {
        try {
          await uploadThumbnail(row.id, ytThumbFile);
        } catch (err: any) {
          toast.error(`썸네일 저장 실패: ${err.message ?? ""}`);
        }
      }
      toast.success("YouTube 영상이 추가되었습니다.");
      setYtUrl("");
      setYtTitle("");
      setYtDesc("");
      setYtClassId(NO_CLASS);
      setYtFolderId(NO_FOLDER);
      setYtPublished(false);
      setYtSort(0);
      setYtPlayback(DEFAULT_PLAYBACK);
      setYtThumbFile(null);
      setResetKey((k) => k + 1);
      onUploaded?.();
    } catch (err: any) {
      toast.error(err.message ?? "추가 실패");
    } finally {
      setYtSaving(false);
    }
  };

  const classSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="수강반 선택" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_CLASS}>미지정</SelectItem>
        {classes.map((c: any) => (
          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const folderSelect = (
    value: string,
    onChange: (v: string) => void,
    list: any[],
    disabled: boolean,
  ) => {
    const tree = buildFolderTree(list);
    return (
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder={disabled ? "수강반을 먼저 선택" : "폴더 선택 (선택 사항)"} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_FOLDER}>폴더 없음</SelectItem>
          {tree.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              <span className="flex items-center gap-1.5">
                {f.depth > 0 && (
                  <span
                    className="text-muted-foreground"
                    style={{ paddingLeft: `${(f.depth - 1) * 12}px` }}
                  >
                    └
                  </span>
                )}
                {f.depth > 0 ? (
                  <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className={f.depth === 0 ? "font-medium" : ""}>{f.name}</span>
                {f.depth > 0 && (
                  <span className="text-xs text-muted-foreground">(하위 폴더)</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  };

  return (
    <Tabs defaultValue="vimeo" className="w-full">
      <TabsList>
        <TabsTrigger value="vimeo" className="gap-2">
          <UploadIcon className="h-4 w-4" /> 파일 업로드 (Vimeo)
        </TabsTrigger>
        <TabsTrigger value="youtube" className="gap-2">
          <Youtube className="h-4 w-4" /> YouTube 링크
        </TabsTrigger>
      </TabsList>


      <TabsContent value="vimeo" className="pt-4">
        <form onSubmit={upload} className="space-y-4">
          <div>
            <Label htmlFor="title">제목</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="desc">설명</Label>
            <Textarea id="desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>수강반</Label>
              {classSelect(classId, (v) => {
                setClassId(v);
                setFolderId(NO_FOLDER);
              })}
            </div>
            <div>
              <Label>폴더</Label>
              {folderSelect(folderId, setFolderId, folders, classId === NO_CLASS)}
            </div>
            <div>
              <Label htmlFor="order">노출 순서</Label>
              <Input
                id="order"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="pub" checked={isPublished} onCheckedChange={setIsPublished} />
            <Label htmlFor="pub">학생에게 공개</Label>
          </div>
          <PlaybackSettings id="up" value={playback} onChange={setPlayback} />
          <ThumbnailPicker key={`up-${resetKey}`} id="up" file={thumbFile} onChange={setThumbFile} />
          <div>
            <Label htmlFor="file">영상 파일</Label>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <Input
                id="file"
                type="file"
                accept="video/*"
                ref={fileRef}
                className="absolute h-0 w-0 opacity-0"
                tabIndex={-1}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant={file ? "secondary" : "outline"}
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
              >
                {file ? "파일 변경" : "파일 선택"}
              </Button>
              {file ? (
                <>
                  <span className="rounded-md bg-muted px-2.5 py-1 text-sm text-muted-foreground">
                    {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={uploading}
                    onClick={() => {
                      setFile(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    aria-label="선택 취소"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <span className="text-sm text-muted-foreground">선택된 파일 없음</span>
              )}

            </div>
          </div>
          {progress !== null && (
            <div>
              <Progress value={progress} />
              <p className="mt-1 text-xs text-muted-foreground">{progress}%</p>
            </div>
          )}
          {file && (
            <Button type="submit" disabled={uploading}>
              {uploading ? "업로드 중..." : "업로드"}
            </Button>
          )}
        </form>
      </TabsContent>

      <TabsContent value="youtube" className="pt-4">
          <form onSubmit={addYt} className="space-y-4">
            <div>
              <Label htmlFor="yt-url">YouTube 링크</Label>
              <Input
                id="yt-url"
                placeholder="https://www.youtube.com/watch?v=..."
                value={ytUrl}
                onChange={(e) => setYtUrl(e.target.value)}
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">
                youtube.com/watch, youtu.be, /embed, /shorts 링크 지원
              </p>
            </div>
            <div>
              <Label htmlFor="yt-title">제목</Label>
              <Input id="yt-title" value={ytTitle} onChange={(e) => setYtTitle(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="yt-desc">설명</Label>
              <Textarea id="yt-desc" rows={3} value={ytDesc} onChange={(e) => setYtDesc(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label>수강반</Label>
                {classSelect(ytClassId, (v) => {
                  setYtClassId(v);
                  setYtFolderId(NO_FOLDER);
                })}
              </div>
              <div>
                <Label>폴더</Label>
                {folderSelect(ytFolderId, setYtFolderId, ytFolders, ytClassId === NO_CLASS)}
              </div>
              <div>
                <Label htmlFor="yt-order">노출 순서</Label>
                <Input
                  id="yt-order"
                  type="number"
                  value={ytSort}
                  onChange={(e) => setYtSort(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="yt-pub" checked={ytPublished} onCheckedChange={setYtPublished} />
              <Label htmlFor="yt-pub">학생에게 공개</Label>
            </div>
            <PlaybackSettings id="yt" value={ytPlayback} onChange={setYtPlayback} />
            <ThumbnailPicker key={`yt-${resetKey}`} id="yt" file={ytThumbFile} onChange={setYtThumbFile} />
            <Button type="submit" disabled={ytSaving}>
              {ytSaving ? "추가 중..." : "추가"}
            </Button>
          </form>
      </TabsContent>
    </Tabs>
  );
}
