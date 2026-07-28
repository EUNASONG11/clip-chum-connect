import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Trash2, Users, Plus, List, ImagePlus, X, Tag, Loader2, Pencil } from "lucide-react";
import {
  listClasses,
  createClass,
  deleteClass,
  updateClass,
  listClassCategories,
  createClassCategory,
  updateClassCategory,
  deleteClassCategory,
} from "@/lib/classes.functions";
import { ClassThumbnailUploader } from "@/components/ClassThumbnailUploader";


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
  const { data: categories = [] } = useQuery({
    queryKey: ["admin", "class-categories"],
    queryFn: () => listClassCategories(),
  });
  const [tab, setTab] = useState("list");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [alwaysActive, setAlwaysActive] = useState(false);
  const [activeFrom, setActiveFrom] = useState("");
  const [activeTo, setActiveTo] = useState("");
  const [categoryId, setCategoryId] = useState<string>("__none__");
  const [filterCategory, setFilterCategory] = useState<string>("__all__");
  const [saving, setSaving] = useState(false);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 카테고리 관리 폼 상태
  const [catName, setCatName] = useState("");
  const [catColor, setCatColor] = useState("#22c55e");
  const [catSaving, setCatSaving] = useState(false);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState("");
  const [editingCatColor, setEditingCatColor] = useState("#22c55e");

  const categoryMap = new Map<string, any>(
    (categories as any[]).map((c) => [c.id as string, c]),
  );
  const filteredClasses = (classes as any[]).filter((c) => {
    if (filterCategory === "__all__") return true;
    if (filterCategory === "__none__") return !c.category_id;
    return c.category_id === filterCategory;
  });



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
    if (!alwaysActive) {
      if (!activeFrom || !activeTo) return toast.error("활성 시작일과 종료일을 입력하거나 상시 활성을 체크하세요.");
      if (activeFrom > activeTo) return toast.error("종료일은 시작일보다 이후여야 합니다.");
    }
    setSaving(true);
    try {
      const row: any = await createClass({
        data: {
          name: name.trim(),
          description: desc || null,
          active_from: alwaysActive ? null : activeFrom,
          active_to: alwaysActive ? null : activeTo,
          category_id: categoryId === "__none__" ? null : categoryId,
        },
      });
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
      setAlwaysActive(false);
      setActiveFrom("");
      setActiveTo("");
      setCategoryId("__none__");
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


  const submitCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) return toast.error("카테고리 이름을 입력하세요.");
    setCatSaving(true);
    try {
      await createClassCategory({
        data: { name: catName.trim(), color: catColor || null },
      });
      setCatName("");
      setCatColor("#22c55e");
      toast.success("카테고리가 추가되었습니다.");
      qc.invalidateQueries({ queryKey: ["admin", "class-categories"] });
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCatSaving(false);
    }
  };

  const saveCategoryEdit = async () => {
    if (!editingCatId) return;
    if (!editingCatName.trim()) return toast.error("이름을 입력하세요.");
    try {
      await updateClassCategory({
        data: { id: editingCatId, name: editingCatName.trim(), color: editingCatColor || null },
      });
      setEditingCatId(null);
      qc.invalidateQueries({ queryKey: ["admin", "class-categories"] });
      qc.invalidateQueries({ queryKey: ["admin", "classes"] });
      toast.success("수정되었습니다.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const removeCategory = async (id: string) => {
    if (!confirm("이 카테고리를 삭제하시겠습니까? 소속된 수강반은 카테고리 미지정으로 변경됩니다.")) return;
    try {
      await deleteClassCategory({ data: { id } });
      qc.invalidateQueries({ queryKey: ["admin", "class-categories"] });
      qc.invalidateQueries({ queryKey: ["admin", "classes"] });
      toast.success("삭제되었습니다.");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const changeClassCategory = async (classId: string, value: string) => {
    try {
      await updateClass({
        data: { id: classId, category_id: value === "__none__" ? null : value },
      });
      qc.invalidateQueries({ queryKey: ["admin", "classes"] });
      toast.success("카테고리가 변경되었습니다.");
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
        <TabsTrigger value="categories" className="gap-1">
          <Tag className="h-4 w-4" /> 카테고리
        </TabsTrigger>
      </TabsList>

      <TabsContent value="list">
        <Card>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>수강반 목록 ({filteredClasses.length}/{classes.length})</CardTitle>
            <div className="w-full sm:w-56">
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="카테고리 필터" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">전체 카테고리</SelectItem>
                  <SelectItem value="__none__">미지정</SelectItem>
                  {(categories as any[]).map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <p className="p-6 text-sm text-muted-foreground">불러오는 중...</p>
            ) : filteredClasses.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">해당 조건의 수강반이 없습니다.</p>
            ) : (
            <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
              {filteredClasses.map((c: any) => {
                const cat = c.category_id ? categoryMap.get(c.category_id) : null;
                return (
                <div
                  key={c.id}
                  className="flex flex-col overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm transition hover:shadow-md"
                >
                  <ClassThumbnailUploader
                    classId={c.id}
                    currentUrl={c.thumbnail_url}
                    onChange={() => qc.invalidateQueries({ queryKey: ["admin", "classes"] })}
                    className="aspect-video w-full"
                  />
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{c.name}</p>
                        {(() => {
                          const today = new Date().toISOString().slice(0, 10);
                          if (!c.active_from && !c.active_to) {
                            return <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-700">상시</span>;
                          }
                          if (c.active_to && today > c.active_to) {
                            return <span className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-700">종료됨</span>;
                          }
                          if (c.active_from && today < c.active_from) {
                            return <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-700">예정</span>;
                          }
                          return <span className="rounded bg-green-500/15 px-1.5 py-0.5 text-[10px] text-green-700">진행중</span>;
                        })()}
                        {cat && (
                          <span
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: `${cat.color ?? "#64748b"}22`,
                              color: cat.color ?? "#334155",
                            }}
                          >
                            <Tag className="h-3 w-3" />
                            {cat.name}
                          </span>
                        )}
                      </div>
                      {(c.active_from || c.active_to) ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          기간: {c.active_from ?? "-"} ~ {c.active_to ?? "-"}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">기간: 상시 활성</p>
                      )}
                      {c.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
                      )}
                      <div className="mt-2">
                        <Select
                          value={c.category_id ?? "__none__"}
                          onValueChange={(v) => changeClassCategory(c.id, v)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="카테고리 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">미지정</SelectItem>
                            {(categories as any[]).map((cat) => (
                              <SelectItem key={cat.id} value={cat.id}>
                                {cat.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
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
                );
              })}
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
                <Label>카테고리</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="카테고리 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">미지정</SelectItem>
                    {(categories as any[]).map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(categories as any[]).length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    카테고리가 없습니다. "카테고리" 탭에서 먼저 추가하세요.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="always_active"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={alwaysActive}
                  onChange={(e) => setAlwaysActive(e.target.checked)}
                />
                <Label htmlFor="always_active" className="cursor-pointer">상시 활성 (기간 제한 없음)</Label>
              </div>
              {!alwaysActive && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="active_from">활성 시작일</Label>
                    <Input id="active_from" type="date" value={activeFrom} onChange={(e) => setActiveFrom(e.target.value)} required={!alwaysActive} />
                  </div>
                  <div>
                    <Label htmlFor="active_to">활성 종료일</Label>
                    <Input id="active_to" type="date" value={activeTo} onChange={(e) => setActiveTo(e.target.value)} required={!alwaysActive} />
                  </div>
                </div>
              )}

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

      <TabsContent value="categories">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5" /> 카테고리 관리
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={submitCategory} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Label htmlFor="cat_name">이름</Label>
                <Input
                  id="cat_name"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="예: 초등, 중등, 고등, 특강"
                />
              </div>
              <div>
                <Label htmlFor="cat_color">색상</Label>
                <Input
                  id="cat_color"
                  type="color"
                  value={catColor}
                  onChange={(e) => setCatColor(e.target.value)}
                  className="h-10 w-16 p-1"
                />
              </div>
              <Button type="submit" disabled={catSaving}>
                {catSaving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}
                추가
              </Button>
            </form>

            <div className="divide-y rounded-md border">
              {(categories as any[]).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">등록된 카테고리가 없습니다.</p>
              ) : (
                (categories as any[]).map((cat) => {
                  const count = (classes as any[]).filter((c) => c.category_id === cat.id).length;
                  const isEditing = editingCatId === cat.id;
                  return (
                    <div key={cat.id} className="flex items-center gap-3 p-3">
                      {isEditing ? (
                        <>
                          <Input
                            type="color"
                            value={editingCatColor}
                            onChange={(e) => setEditingCatColor(e.target.value)}
                            className="h-9 w-14 p-1"
                          />
                          <Input
                            value={editingCatName}
                            onChange={(e) => setEditingCatName(e.target.value)}
                            className="h-9 flex-1"
                          />
                          <Button size="sm" onClick={saveCategoryEdit}>저장</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingCatId(null)}>
                            취소
                          </Button>
                        </>
                      ) : (
                        <>
                          <span
                            className="inline-block h-4 w-4 flex-shrink-0 rounded"
                            style={{ backgroundColor: cat.color ?? "#94a3b8" }}
                          />
                          <span className="flex-1 truncate font-medium">{cat.name}</span>
                          <span className="text-xs text-muted-foreground">{count}개 수강반</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingCatId(cat.id);
                              setEditingCatName(cat.name);
                              setEditingCatColor(cat.color ?? "#22c55e");
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => removeCategory(cat.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

