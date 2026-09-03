import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listManagedNotices,
  createNotice,
  updateNotice,
  deleteNotice,
} from "@/lib/notices.functions";
import { AdminOnly } from "@/components/AdminRole";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Megaphone, Pencil, Pin, Plus, Trash2, ExternalLink, Copy, ImagePlus, Loader2 } from "lucide-react";

const BRANCHES = ["상동", "청라", "송도"];
const IMAGE_BUCKET = "notice-images";
type NoticeCardForm = { title: string; body: string; imageUrl: string | null };

type FormState = {
  id?: string;
  title: string;
  body: string;
  cardBody: string;
  cards: NoticeCardForm[];
  branch: string;
  displayType: ("main" | "card")[];
  isPinned: boolean;
  isPublished: boolean;
};

const emptyForm: FormState = {
  title: "",
  body: "",
  cardBody: "",
  cards: [],
  branch: "",
  displayType: ["card"],
  isPinned: false,
  isPublished: true,
};

function AdminNoticesPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listManagedNotices);
  const create = useServerFn(createNotice);
  const update = useServerFn(updateNotice);
  const remove = useServerFn(deleteNotice);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [uploadingCard, setUploadingCard] = useState<number | null>(null);
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    let cancelled = false;

    const loadPreviewUrls = async () => {
      const entries = await Promise.all(
        form.cards.map(async (card, index) => {
          if (!card.imageUrl) return [index, ""] as const;
          if (card.imageUrl.startsWith("http")) return [index, card.imageUrl] as const;
          const { data: signed } = await supabase.storage
            .from(IMAGE_BUCKET)
            .createSignedUrl(card.imageUrl, 60 * 60);
          return [index, signed?.signedUrl ?? ""] as const;
        }),
      );
      if (!cancelled) {
        setPreviewUrls(
          Object.fromEntries(entries.filter(([, url]) => url)),
        );
      }
    };

    void loadPreviewUrls();
    return () => {
      cancelled = true;
    };
  }, [form.cards]);

  const { data, isLoading } = useQuery({
    queryKey: ["managed-notices"],
    queryFn: () => fetchList(),
    staleTime: 30 * 1000,
  });
  const notices = data?.notices ?? [];

  const updateCard = (index: number, patch: Partial<NoticeCardForm>) =>
    setForm((f) => ({
      ...f,
      cards: f.cards.map((card, cardIndex) => (cardIndex === index ? { ...card, ...patch } : card)),
    }));

  const uploadCardImage = async (index: number, file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("이미지 파일만 업로드할 수 있습니다.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("10MB 이하 이미지를 사용하세요.");
      return;
    }
    setUploadingCard(index);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${form.id ?? "new"}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      updateCard(index, { imageUrl: path });
      toast.success("카드 이미지가 첨부되었습니다. 저장을 눌러 반영하세요.");
    } catch (error: any) {
      toast.error(error?.message ?? "이미지 업로드에 실패했습니다.");
    } finally {
      setUploadingCard(null);
      const input = fileRefs.current[index];
      if (input) input.value = "";
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (values: FormState) => {
      const payload = {
        title: values.title,
        body: values.body,
        cardBody: null,
        cards: values.cards
          .map((card) => ({
            title: card.title.trim(),
            body: card.body.trim(),
            imageUrl: card.imageUrl,
          }))
          .filter((card) => card.title && card.body),
        branch: values.branch.trim() || null,
        displayType: values.displayType.length ? values.displayType : ["card" as const],
        isPinned: values.isPinned,
        isPublished: values.isPublished,
      };
      if (values.id) return update({ data: { ...payload, id: values.id } });
      return create({ data: payload });
    },
    onSuccess: () => {
      toast.success("공지사항을 저장했습니다.");
      setOpen(false);
      setForm(emptyForm);
      qc.invalidateQueries({ queryKey: ["managed-notices"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "저장에 실패했습니다."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("공지사항을 삭제했습니다.");
      qc.invalidateQueries({ queryKey: ["managed-notices"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "삭제에 실패했습니다."),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold"><Megaphone className="h-5 w-5 text-primary" /> 공지사항 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">게시된 공지는 로그인 없이 누구나 볼 수 있습니다.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild><a href="/notice" target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-4 w-4" /> 공개 페이지</a></Button>
          <Button size="sm" onClick={() => { setForm(emptyForm); setOpen(true); }}><Plus className="mr-1 h-4 w-4" /> 공지 작성</Button>
        </div>
      </div>

      <Card className="p-3 text-xs text-muted-foreground">공개 링크: <span className="font-mono">{"{사이트 주소}"}/notice</span></Card>

      {isLoading ? <p className="py-10 text-center text-sm text-muted-foreground">불러오는 중…</p> : notices.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">등록된 공지사항이 없습니다.</p> : (
        <div className="space-y-2">
          {notices.map((n: any) => (
            <Card key={n.id} className="flex flex-wrap items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {n.is_pinned && <Badge className="gap-1"><Pin className="h-3 w-3" /> 중요</Badge>}
                  <Badge variant={n.is_published ? "secondary" : "outline"}>{n.is_published ? "게시중" : "숨김"}</Badge>
                  {n.branch && <Badge variant="outline">{n.branch}</Badge>}
                  {n.display_type.includes("main") && <Badge variant="outline">메인 설명</Badge>}
                  {n.display_type.includes("card") && <Badge variant="outline">카드</Badge>}
                  <span className="truncate font-semibold">{n.title}</span>
                </div>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString("ko-KR")}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="outline" size="sm" title="공지 주소 복사" onClick={async () => { const url = `${window.location.origin}/notice/${n.id}`; try { await navigator.clipboard.writeText(url); toast.success("공지 주소를 복사했습니다."); } catch { toast.error("주소 복사에 실패했습니다."); } }}><Copy className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" onClick={() => { setForm({ id: n.id, title: n.title, body: n.body ?? "", cardBody: n.card_body ?? "", cards: Array.isArray(n.cards) && n.cards.length > 0 ? (n.cards as NoticeCardForm[]).map((card) => ({ ...card, imageUrl: card.imageUrl ?? null })) : n.card_body ? [{ title: n.title, body: n.card_body, imageUrl: null }] : [], branch: n.branch ?? "", displayType: ((n.display_type ?? ["card"]) as ("main" | "card")[]), isPinned: n.is_pinned, isPublished: n.is_published }); setOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                <Button variant="outline" size="sm" onClick={() => deleteMutation.mutate(n.id)} disabled={deleteMutation.isPending}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader><DialogTitle>{form.id ? "공지 수정" : "공지 작성"}</DialogTitle></DialogHeader>
          <div className="space-y-6">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">기본 정보</h4>
              <div className="space-y-1.5"><Label>제목</Label><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="공지 제목" /></div>
            </div>
            <hr className="border-border" />
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground">공지 내용</h4>
              <div className="space-y-3">
                <Label>노출 위치</Label>
                <div className="space-y-2">{(["main", "card"] as const).map((type) => <div key={type} className="flex items-start gap-2"><Checkbox id={`display-${type}`} checked={form.displayType.includes(type)} onCheckedChange={(checked) => setForm((f) => { const next = checked ? [...new Set([...f.displayType, type])] : f.displayType.filter((item) => item !== type); return { ...f, displayType: next.length ? next : ["card"] }; })} /><div className="grid gap-0.5 leading-none"><Label htmlFor={`display-${type}`} className="cursor-pointer text-sm font-medium">{type === "main" ? "메인 설명" : "공지 카드"}</Label><p className="text-xs text-muted-foreground">{type === "main" ? "공지 페이지 상단 안내 영역에 표시" : "공지 페이지 카드 목록에 표시"}</p></div></div>)}</div>
              </div>
              {form.displayType.includes("main") && <div className="space-y-1.5"><Label>메인 설명 본문</Label><Textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} rows={8} placeholder="공지 페이지 상단 안내 영역에 표시될 내용을 입력하세요." /></div>}
              {form.displayType.includes("card") && <div className="space-y-2">
                <div className="flex items-center justify-between"><Label>공지 카드 ({form.cards.length}개)</Label><Button type="button" variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, cards: [...f.cards, { title: "", body: "", imageUrl: null }] }))}><Plus className="mr-1 h-3.5 w-3.5" /> 카드 추가</Button></div>
                {form.cards.length === 0 ? <p className="text-xs text-muted-foreground">{form.displayType.includes("main") ? "카드를 추가하지 않으면 메인 설명 본문이 카드로 표시됩니다." : "카드 추가 버튼을 눌러 카드를 만드세요."}</p> : <div className="space-y-3">{form.cards.map((card, i) => <div key={i} className="space-y-2 rounded-md border border-border/60 p-3">
                  <div className="flex items-center justify-between gap-2"><Input value={card.title} onChange={(e) => updateCard(i, { title: e.target.value })} placeholder={`카드 ${i + 1} 제목`} /><Button type="button" variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, cards: f.cards.filter((_, index) => index !== i) }))}><Trash2 className="h-4 w-4" /></Button></div>
                  <Textarea value={card.body} onChange={(e) => updateCard(i, { body: e.target.value })} rows={4} placeholder="카드에 표시될 내용을 입력하세요." />
                  <input ref={(element) => { fileRefs.current[i] = element; }} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadCardImage(i, file); }} />
                  {previewUrls[i] && <img src={previewUrls[i]} alt="첨부된 카드 이미지 미리보기" className="max-h-40 w-full rounded-md border object-cover" />}
                  <div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={() => fileRefs.current[i]?.click()} disabled={uploadingCard === i}>{uploadingCard === i ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1 h-4 w-4" />} {card.imageUrl ? "이미지 교체" : "이미지 첨부"}</Button>{card.imageUrl && <Button type="button" variant="ghost" size="sm" onClick={() => updateCard(i, { imageUrl: null })}>이미지 제거</Button>}</div>
                </div>)}</div>}
              </div>}
            </div>
            <hr className="border-border" />
            <div className="space-y-3"><h4 className="text-sm font-semibold text-foreground">노출 설정</h4><div className="space-y-1.5"><Label>교육원</Label><Select value={form.branch || "__all__"} onValueChange={(value) => setForm((f) => ({ ...f, branch: value === "__all__" ? "" : value }))}><SelectTrigger><SelectValue placeholder="전체 공지" /></SelectTrigger><SelectContent><SelectItem value="__all__">전체 공지</SelectItem>{BRANCHES.map((branch) => <SelectItem key={branch} value={branch}>{branch}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground">선택하지 않으면 모든 교육원에 노출됩니다.</p></div><div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"><div className="space-y-0.5"><Label className="cursor-pointer">상단 고정</Label><p className="text-xs text-muted-foreground">중요 공지를 목록 최상단에 고정합니다.</p></div><Switch checked={form.isPinned} onCheckedChange={(value) => setForm((f) => ({ ...f, isPinned: value }))} /></div><div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2"><div className="space-y-0.5"><Label className="cursor-pointer">게시 상태</Label><p className="text-xs text-muted-foreground">OFF로 설정하면 공개 페이지에 표시되지 않습니다.</p></div><Switch checked={form.isPublished} onCheckedChange={(value) => setForm((f) => ({ ...f, isPublished: value }))} /></div></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>취소</Button><Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending || !form.title.trim()}>저장</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
