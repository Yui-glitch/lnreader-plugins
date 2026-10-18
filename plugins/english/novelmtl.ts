import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as parseHTML } from 'cheerio';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
class NovelMTL implements Plugin.PluginBase {
  id = 'novelmtl';
  name = 'NovelMTL';
  icon = 'src/en/favicon-96x96.png';
  site = 'https://novelmtl.app';
  version = '1.0.2';
  private headers(referer?: string) {
    return {
      Referer: referer || this.site + '/',
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
    };
  }
  private cleanTitle(raw: string): string {
    const t = raw.replace(/\s+/g, ' ').trim();
    const i = t.search(/[\u3400-\u9fff\uf900-\ufaff]/);
    return (i > 0 ? t.slice(0, i) : t).trim();
  }
  private parseList(html: string): Plugin.NovelItem[] {
    const $ = parseHTML(html);
    const seen = new Set<string>();
    const novels: Plugin.NovelItem[] = [];
    $('a[href*="/novel/"]').each((_, el) => {
      const a = $(el);
      const href = (a.attr('href') || '').replace(this.site, '');
      if (!/^\/novel\/[^/]+\/?$/.test(href) || /read\/\d+/.test(href)) return;
      const path = href.replace(/\/$/, '');
      if (seen.has(path)) return;
      const name = this.cleanTitle(a.text());
      if (!name || /^read more$/i.test(name)) return;
      seen.add(path);
      const img = a.find('img').first();
      const cover = img.attr('data-src') || img.attr('src') || undefined;
      novels.push({
        name,
        path,
        cover: cover
          ? cover.startsWith('http')
            ? cover
            : this.site + cover
          : defaultCover,
      });
    });
    return novels;
  }
  async popularNovels(
    pageNo: number,
    { showLatestNovels }: Plugin.PopularNovelsOptions,
  ): Promise<Plugin.NovelItem[]> {     if (pageNo > 1) return [];
    const url = pageNo > 1 ? `${this.site}/?page=${pageNo}` : `${this.site}/`;
    const res = await fetchApi(url, { headers: this.headers() });
    const html = await res.text();
    return this.parseList(html);
  }
  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = this.site + novelPath;
    const res = await fetchApi(url, { headers: this.headers() });
    const html = await res.text();
    const $ = parseHTML(html);
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: this.cleanTitle(
        $('h1').first().text() ||
          ($('meta[property="og:title"]').attr('content') || '').trim(),
      ),
      cover: defaultCover,
    };
    const cover = $(
      'img[src*="cover"], img[data-src*="cover"], .cover img, .book img',
    ).first();
    const coverSrc = cover.attr('data-src') || cover.attr('src');
    if (coverSrc) {
      novel.cover = coverSrc.startsWith('http')
        ? coverSrc
        : this.site + coverSrc;
    }
    novel.author = (
      $('meta[name="author"]').attr('content') ||
      $('meta[property="book:author"]').attr('content') ||
      ''
    ).trim();
    novel.genres = (
      $('meta[property="book:genre"]').attr('content') ||
      $('meta[property="book:tag"]').attr('content') ||
      ''
    )
      .split(',')
      .map(g => g.trim())
      .filter(Boolean)
      .join(',');
    novel.summary = (
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      ''
    ).trim();
    const titleTag =
      $('title').text() + ' ' + ($('meta[name="keywords"]').attr('content') || '');
    novel.status = /\bCompleted\b/i.test(titleTag)
      ? NovelStatus.Completed
      : /\bOngoing\b/i.test(titleTag)
        ? NovelStatus.Ongoing
        : NovelStatus.Unknown;
    const chapters: Plugin.ChapterItem[] = [];
    const seen = new Set<number>();
    const slug = novelPath.replace(/\/$/, '');
    $('a[href*="/read/"]').each((_, el) => {
      const href = ($(el).attr('href') || '').replace(this.site, '');
      const m = href.match(/\/read\/(\d+)/);
      if (!m) return;
      const n = Number(m[1]);
      if (seen.has(n)) return;
      seen.add(n);
      chapters.push({
        name: `Chapter ${n}`,
        path: `${slug}/read/${n}`,
        chapterNumber: n,
      });
    });
    const countMatch = $.text().match(/(\d[\d,]*)\s*pages/i);
    const total = countMatch ? Number(countMatch[1].replace(/,/g, '')) : 0;
    for (let n = 1; n <= total; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      chapters.push({
        name: `Chapter ${n}`,
        path: `${slug}/read/${n}`,
        chapterNumber: n,
      });
    }
    novel.chapters = chapters.sort(
      (a, b) => (a.chapterNumber || 0) - (b.chapterNumber || 0),
    );
    return novel;
  }
  async parseChapter(chapterPath: string): Promise<string> {
    const novelPath = chapterPath.replace(/\/read\/\d+.*$/, '');
    const res = await fetchApi(this.site + chapterPath, {
      headers: this.headers(this.site + novelPath),
    });
    const html = await res.text();
    const $ = parseHTML(html);
    const selectors = [
      '#chapter-content',
      '.chapter-content',
      '#content',
      '.reading-content',
      '.chapter-body',
      '.text-left',
      'article',
      'main',
    ];
    let container = $();
    for (const s of selectors) {
      const el = $(s).first();
      if (el.length && el.text().trim().length > 200) {
        container = el;
        break;
      }
    }
    if (!container.length) container = $('body');
    container
      .find(
        'script, style, nav, header, footer, iframe, ins, button, .ads, .ad, [class*="advert"], [id*="google"]',
      )
      .remove();
    const paras = container.find('p');
    if (paras.length > 3) {
      return paras
        .map((_, p) => `<p>${$(p).html()}</p>`)
        .get()
        .join('\n');
    }
    return container.html() || '';
  }
  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {     if (pageNo > 1) return [];
    const url = `${this.site}/search?q=${encodeURIComponent(searchTerm)}${
      pageNo > 1 ? `&page=${pageNo}` : ''
    }`;
    const res = await fetchApi(url, { headers: this.headers() });
    const html = await res.text();
    return this.parseList(html);
  }
}
export default new NovelMTL();
