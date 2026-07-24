import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as tus from "tus-js-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Upload as UploadIcon, Youtube } from "lucide-react";
import { createVimeoUpload, finalizeVideo, addYoutubeVideo } from "@/lib/vimeo.functions";
import { listClasses } from "@/lib/classes.functions";
import { RoleGate } from "@/components/AdminRole";

export const Route = createFileRoute("/admin/upload")({
  component: UploadPage,
});

const NO_CLASS = "__none__";

function UploadPage() {
  const { data: classes = [] } = useQuery({
    queryKey: ["admin", "classes"],
    queryFn: () => listClasses(),
  });

  // Vimeo 업로드
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [classId, setClassId] = useState<string>(NO_CLASS);
  const [isPublished, setIsPublished] = useState(false);
  const [sortOrder, setSortOrder] = useState<number>(0);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // YouTube
  const [ytUrl, setYtUrl] = useState("");
  const [ytTitle, setYtTitle] = useState("");
  const [ytDesc, setYtDesc] = useState("");
  const [ytClassId, setYtClassId] = useState<string>(NO_CLASS);
  const [ytPublished, setYtPublished] = useState(false);
  const [ytSort, setYtSort] = useState<number>(0);
  const [ytSaving, setYtSaving] = useState(false);

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

      await finalizeVideo({
        data: {
          uri: session.uri,
          title,
          description: description || null,
          class_id: classId === NO_CLASS ? null : classId,
          is_published: isPublished,
          sort_order: sortOrder,
        },
      });

      toast.success("업로드 완료! Vimeo 처리 후 자동으로 재생 가능합니다.");
      setTitle("");
      setDescription("");
      setClassId(NO_CLASS);
      setIsPublished(false);
      setSortOrder(0);
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setProgress(null);
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
      await addYoutubeVideo({
        data: {
          url: ytUrl.trim(),
          title: ytTitle,
          description: ytDesc || null,
          class_id: ytClassId === NO_CLASS ? null : ytClassId,
          is_published: ytPublished,
          sort_order: ytSort,
        },
      });
      toast.success("YouTube 영상이 추가되었습니다.");
      setYtUrl("");
      setYtTitle("");
      setYtDesc("");
      setYtClassId(NO_CLASS);
      setYtPublished(false);
      setYtSort(0);
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

  return (
    <RoleGate>
      <Card>
        <CardHeader>
          <CardTitle>새 영상 추가</CardTitle>
        </CardHeader>
        <CardContent>
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label>수강반</Label>
                    {classSelect(classId, setClassId)}
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
                <div>
                  <Label htmlFor="file">영상 파일</Label>
                  <Input
                    id="file"
                    type="file"
                    accept="video/*"
                    ref={fileRef}
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  />
                  {file && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB
                    </p>
                  )}
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label>수강반</Label>
                    {classSelect(ytClassId, setYtClassId)}
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
                <Button type="submit" disabled={ytSaving}>
                  {ytSaving ? "추가 중..." : "추가"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </RoleGate>
  );
}
