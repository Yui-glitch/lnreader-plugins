import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as parseHTML } from 'cheerio';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { FilterTypes, Filters } from '@libs/filterInputs';
const GENRES = [
  'Female-Lead', 'Male-Lead', 'BL', 'GL', 'Modern Romance', 'Xianxia', 'Wuxia',
  'Xuanhuan', 'System', 'Urban Life', 'Rebirth', 'Transmigration',
  'Asexual / Platonic', 'Book-Entering', 'Sweet Romance', 'Cultivation',
  'Horror', 'Supernatural', 'Action', 'Adventure', 'Fantasy', 'Eastern Fantasy',
  'Douluo', 'Harem', 'Game Lit / MMO', 'Comedy', 'School / Campus',
  'Slice of Life', 'Otherworld / Isekai', 'Martial Arts', 'Historical Romance',
  'Post-Apocalypse', 'Angst / Tragedy Romance', 'Marriage / Contract',
  'Pursuit / Redemption', 'Political Intrigue', 'Military Strategy',
  'Mystery / Detective', 'Villain Redemption', 'Workplace Romance',
  'Entertainment / Idol', 'Everyday Life', 'Domestic Life', 'Coming-of-Age',
  'Palace / Domestic Intrigue', 'Infinite Flow',
];
class NovelMTL implements Plugin.PluginBase {
  id = 'novelmtl';
  name = 'NovelMTL';
  icon = 'src/en/novelmtl/icon.png';
  site = 'https://novelmtl.app';
  version = '1.1.0';
  filters = {
    genre: {
      type: FilterTypes.Picker,
      label: 'Genre',
      value: '',
      options: [
        { label: 'All', value: '' },
        ...GENRES.map(g => ({ label: g, value: g })),
      ],
    },
  } satisfies Filters;
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
  private toNovels(items: any[]): Plugin.NovelItem[] {
    return (items || []).map(i => ({
      name: String(i.title || '').trim(),
      path: `/novel/${i.slug}`,
      cover: defaultCover,
    }));
  }
  async popularNovels(
    pageNo: number,
    { filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const params: string[] = [];
    if (pageNo > 1) params.push(`cursor=${(pageNo - 1) * 20}`);
    const genre = filters?.genre?.value;
    if (genre) params.push(`genres=${encodeURIComponent(String(genre))}`);
    const url = `${this.site}/api/novels${params.length ? '?' + params.join('&') : ''}`;
    const res = await fetchApi(url, { headers: this.headers() });
    const json = await res.json();
    return this.toNovels(json.items);
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
  ): Promise<Plugin.NovelItem[]> {
    const offset = (pageNo - 1) * 20;
    const url = `${this.site}/api/novels/search?q=${encodeURIComponent(searchTerm)}${
      offset > 0 ? `&offset=${offset}` : ''
    }`;
    const res = await fetchApi(url, { headers: this.headers() });
    const json = await res.json();
    return this.toNovels(json.items);
  }
}
export default new NovelMTL();
