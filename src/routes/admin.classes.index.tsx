import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Trash2, Users, Plus, List } from "lucide-react";
import { listClasses, createClass, deleteClass } from "@/lib/classes.functions";
import { ClassThumbnailUploader } from "@/components/ClassThumbnailUploader";

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

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("수강반 이름을 입력하세요.");
    setSaving(true);
    try {
      await createClass({ data: { name: name.trim(), description: desc || null } });
      setName("");
      setDesc("");
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
              <ul className="divide-y">
                {classes.map((c: any) => (
                  <li key={c.id} className="flex items-center gap-3 py-3">
                    <div className="h-14 w-24 flex-shrink-0 overflow-hidden rounded bg-muted">
                      {c.thumbnail_url ? (
                        <img src={c.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{c.name}</p>
                      {c.description && (
                        <p className="truncate text-xs text-muted-foreground">{c.description}</p>
                      )}
                      <div className="mt-2">
                        <ClassThumbnailUploader
                          classId={c.id}
                          currentUrl={c.thumbnail_url}
                          size="sm"
                          onChange={() => qc.invalidateQueries({ queryKey: ["admin", "classes"] })}
                        />
                      </div>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/admin/classes/$id" params={{ id: c.id }}>
                        <Users className="mr-1 h-4 w-4" /> 관리
                      </Link>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </li>
                ))}
              </ul>
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
