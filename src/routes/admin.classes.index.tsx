import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Trash2, Users, Plus, List, ImagePlus, X } from "lucide-react";
import { listClasses, createClass, deleteClass, updateClass } from "@/lib/classes.functions";
import { ClassThumbnailUploader } from "@/components/ClassThumbnailUploader";
import { ClassThumb } from "@/components/ClassThumb";

import { supabase } from "@/integrations/supabase/client";


export const Route = createFileRoute("/admin/classes/")({
  component: ClassesPage,
});

function ClassesPage() {
  const qc = useQueryClient();
  const { data: classes = [], isLoading } = useQuery({
    queryKey: ["admin", "classes"],
    queryFn: () => listClasses(),
  });
  const [tab, setTab] = useState("list");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickThumb = (file: File | null) => {
    if (!file) {
      setThumbFile(null);
      setThumbPreview(null);
      return;
    }
    if (!file.type.startsWith("image/")) return toast.error("이미지 파일만 업로드할 수 있습니다.");
    if (file.size > 5 * 1024 * 1024) return toast.error("5MB 이하 이미지를 사용하세요.");
    setThumbFile(file);
    setThumbPreview(URL.createObjectURL(file));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("수강반 이름을 입력하세요.");
    setSaving(true);
    try {
      const row: any = await createClass({ data: { name: name.trim(), description: desc || null } });
      if (thumbFile && row?.id) {
        const ext = thumbFile.name.split(".").pop() || "jpg";
        const path = `${row.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("class-thumbnails")
          .upload(path, thumbFile, { upsert: true, contentType: thumbFile.type });
        if (upErr) throw upErr;
        await updateClass({ data: { id: row.id, thumbnail_url: path } });
      }

      setName("");
      setDesc("");
      setThumbFile(null);
      setThumbPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.success("수강반이 생성되었습니다.");
      qc.invalidateQueries({ queryKey: ["admin", "classes"] });
      setTab("list");
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };


  const remove = async (id: string) => {
    if (!confirm("이 수강반을 삭제하시겠습니까? 배정된 학생 정보도 삭제됩니다.")) return;
    try {
      await deleteClass({ data: { id } });
      qc.invalidateQueries({ queryKey: ["admin", "classes"] });
      toast.success("삭제되었습니다.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-6">
      <TabsList>
        <TabsTrigger value="list" className="gap-1">
          <List className="h-4 w-4" /> 수강반 목록
        </TabsTrigger>
        <TabsTrigger value="create" className="gap-1">
          <Plus className="h-4 w-4" /> 수강반 생성
        </TabsTrigger>
      </TabsList>

      <TabsContent value="list">
        <Card>
          <CardHeader>
            <CardTitle>수강반 목록 ({classes.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">불러오는 중...</p>
            ) : classes.length === 0 ? (
              <p className="text-sm text-muted-foreground">아직 등록된 수강반이 없습니다.</p>
            ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {classes.map((c: any) => (
                <div
                  key={c.id}
                  className="flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm transition hover:shadow-md"
                >
                  <div className="aspect-video w-full overflow-hidden bg-muted">
                    {c.thumbnail_url ? (
                      <ClassThumb src={c.thumbnail_url} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImagePlus className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex-1">
                      <p className="truncate font-medium">{c.name}</p>
                      {c.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
                      )}
                    </div>
                    <div className="mt-3">
                      <ClassThumbnailUploader
                        classId={c.id}
                        currentUrl={c.thumbnail_url}
                        size="sm"
                        onChange={() => qc.invalidateQueries({ queryKey: ["admin", "classes"] })}
                      />
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <Button asChild size="sm" variant="outline" className="flex-1">
                        <Link to="/admin/classes/$id" params={{ id: c.id }}>
                          <Users className="mr-1 h-4 w-4" /> 관리
                        </Link>
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="create">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" /> 새 수강반
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="name">이름</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="desc">설명</Label>
                <Textarea id="desc" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
              <div>
                <Label>썸네일 (선택)</Label>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex h-24 w-40 flex-shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted transition hover:opacity-80"
                    aria-label="썸네일 선택"
                  >
                    {thumbPreview ? (
                      <img src={thumbPreview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <ImagePlus className="h-6 w-6 text-muted-foreground" />
                    )}
                  </button>
                  <div className="flex flex-col gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                      <ImagePlus className="mr-1 h-3 w-3" /> {thumbPreview ? "변경" : "선택"}
                    </Button>
                    {thumbPreview && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => pickThumb(null)}>
                        <X className="mr-1 h-3 w-3" /> 제거
                      </Button>
                    )}
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => pickThumb(e.target.files?.[0] ?? null)}
                  />
                </div>
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? "생성 중..." : "생성"}
              </Button>

            </form>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
