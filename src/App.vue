<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { CdxButton, CdxDialog, CdxField, CdxIcon, CdxLookup, CdxMessage, CdxSelect, CdxTextInput } from '@wikimedia/codex';
import { cdxIconArrowDown, cdxIconArrowUp, cdxIconTrash, cdxIconEdit } from '@wikimedia/codex-icons';

const params = new URLSearchParams(window.location.search);
const wikiHost = params.get('wiki') || 'en.wikipedia.org';
const api = `https://${wikiHost}/w/api.php`;
const baseUrl = `https://${wikiHost}/w/`;
const articlePath = `https://${wikiHost}/wiki/`;
const booksStorageKey = 'collections-from-rl-books';
const activeBookStorageKey = 'collections-from-rl-active-book-id';
const bookQueryParameters = [ 'titles', 'id', 'wiki', 'name', 'desc' ];
const pageQueryProps = { prop: 'revisions|pageimages|description', rvprop: 'ids|timestamp', piprop: 'thumbnail', pithumbsize: '120' };

function pageToItem(page) {
  const revision = page.revisions?.[0] || {};
  return {
    type: 'article', content_type: 'text/x-wiki', title: page.title,
    revision: revision.revid || 0, latest: revision.revid || 0,
    timestamp: revision.timestamp ? Math.floor(new Date(revision.timestamp).getTime() / 1000) : '',
    url: `${articlePath}${encodeURIComponent(page.title.replaceAll(' ', '_'))}`, currentVersion: 1,
    thumbnail: page.thumbnail?.source || '', description: page.description || ''
  };
}

function defaultBook() {
  return {
    id: 0,
    title: '',
    subtitle: '',
    items: [],
    titles: ''
  };
}

function storedBooks() {
  try {
    const saved = JSON.parse(localStorage.getItem(booksStorageKey));
    return Array.isArray(saved) && saved.length ? saved : [ defaultBook() ];
  } catch {
    return [ defaultBook() ];
  }
}

const books = ref(storedBooks());
const savedActiveBookId = Number(localStorage.getItem(activeBookStorageKey));
const activeBookId = ref(books.value.some((book) => book.id === savedActiveBookId) ? savedActiveBookId : 0);
const saveBookName = ref('');
const noticeText = ref('Loading pages from Wikipedia...');
const noticeType = ref('notice');
const noticeVisible = ref(true);
const metabookOpen = ref(false);

const activeBook = computed(() => books.value.find((book) => book.id === activeBookId.value) || books.value[0]);
saveBookName.value = activeBook.value.title;
watch(() => activeBook.value.title, (newTitle) => { saveBookName.value = newTitle; });
const bookOptions = computed(() => books.value.map((book) => ({
  value: String(book.id),
  label: book.title || `Book ${book.id}`
})));
const selectedBookId = computed({
  get: () => String(activeBookId.value),
  set: (value) => { selectBook(Number(value)); }
});
const title = computed({
  get: () => activeBook.value.title,
  set: (value) => { activeBook.value.title = value; }
});
const subtitle = computed({
  get: () => activeBook.value.subtitle,
  set: (value) => { activeBook.value.subtitle = value; }
});
const items = computed({
  get: () => activeBook.value.items,
  set: (value) => { activeBook.value.items = value; }
});
const articleCount = computed(() => items.value.filter((item) => item.type === 'article' && !item.missing).length);
const metabook = computed(() => buildMetabook());
const hasItems = computed(() => items.value.length > 0);

function saveBooks() {
  localStorage.setItem(booksStorageKey, JSON.stringify(books.value));
}

watch(books, saveBooks, { deep: true });
watch(activeBookId, (value) => {
  localStorage.setItem(activeBookStorageKey, String(value));
});

function showNotice(message, type = 'notice') {
  noticeText.value = message;
  noticeType.value = type;
  noticeVisible.value = true;
}

function buildMetabook() {
  const result = {
    type: 'collection',
    licenses: [ {
      type: 'license',
      name: 'License',
      mw_license_url: `${baseUrl}index.php?title=${encodeURIComponent('Wikipedia:Text_of_the_Creative_Commons_Attribution-ShareAlike_4.0_International_License')}&action=raw`
    } ],
    title: title.value,
    subtitle: subtitle.value,
    items: [],
    wikis: [ { type: 'wikiconf', baseurl: baseUrl, script_extension: '.php', format: 'nuwiki' } ]
  };
  let currentChapter = null;
  items.value.forEach((item) => {
    if (item.missing) return;
    if (item.type === 'chapter') {
      if (currentChapter) result.items.push(currentChapter);
      currentChapter = { type: 'chapter', title: item.title, items: [] };
      return;
    }
    const article = {
      type: 'article', content_type: 'text/x-wiki', title: item.title,
      revision: String(item.revision), latest: String(item.latest), timestamp: item.timestamp,
      url: item.url, currentVersion: item.currentVersion
    };
    if (currentChapter) currentChapter.items.push(article);
    else result.items.push(article);
  });
  if (currentChapter) result.items.push(currentChapter);
  return result;
}

function metabookJson(pretty = false) {
  return JSON.stringify(metabook.value, null, pretty ? 2 : 0);
}

const TITLES_PER_REQUEST = 50;
const BATCH_DELAY_MS = 2000;
function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function loadTitles(titlesString) {
  const titles = titlesString ? titlesString.split('|').map((item) => item.trim()).filter(Boolean) : [];
  if (!titles.length) {
    showNotice('No pages requested. Add ?titles=Page1|Page2 to the URL.', 'warning');
    return;
  }
  // The API caps `titles` at 50 per request, so batch and pace the requests.
  const batches = chunk(titles, TITLES_PER_REQUEST);
  const merged = { query: { pages: [], normalized: [], redirects: [] } };
  try {
    for (let i = 0; i < batches.length; i++) {
      if (i > 0) {
        showNotice(`Loading pages… (batch ${i + 1} of ${batches.length})`);
        await delay(BATCH_DELAY_MS);
      }
      const query = new URLSearchParams({ action: 'query', ...pageQueryProps, titles: batches[i].join('|'), redirects: '1', format: 'json', formatversion: '2', origin: '*' });
      const response = await fetch(`${api}?${query}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const q = data?.query || {};
      merged.query.pages.push(...(q.pages || []));
      merged.query.normalized.push(...(q.normalized || []));
      merged.query.redirects.push(...(q.redirects || []));
    }
    buildFromApi(titles, merged);
  } catch (error) {
    showNotice(`Could not load pages from ${wikiHost}: ${error.message}. (Open this file over http(s) or check the wiki host.)`, 'error');
  }
}

function buildFromApi(requestedTitles, data) {
  const query = data?.query || {};
  const pages = query.pages || [];
  const aliases = {};
  [...(query.normalized || []), ...(query.redirects || [])].forEach((entry) => { aliases[entry.from] = entry.to; });
  const resolve = (requested) => {
    const seen = new Set();
    let resolved = requested;
    while (aliases[resolved] && !seen.has(resolved)) {
      seen.add(resolved);
      resolved = aliases[resolved];
    }
    return resolved;
  };
  const byTitle = Object.fromEntries(pages.map((page) => [page.title, page]));
  let missingCount = 0;
  items.value = requestedTitles.map((requestedTitle) => {
    const canonical = resolve(requestedTitle);
    const page = byTitle[canonical] || pages.find((candidate) => candidate.title.toLowerCase() === requestedTitle.toLowerCase());
    if (!page || page.missing) {
      missingCount++;
      const missingTitle = page?.title || canonical;
      return { type: 'article', title: missingTitle, revision: 0, latest: 0, timestamp: '', url: `${articlePath}${encodeURIComponent(missingTitle.replaceAll(' ', '_'))}`, currentVersion: 1, missing: true };
    }
    return pageToItem(page);
  });
  const found = items.value.length - missingCount;
  if (missingCount) showNotice(`${found} page(s) loaded, ${missingCount} not found (shown in red).`, 'warning');
  else {
    noticeVisible.value = false;
    showNotice(`${found} page(s) loaded from ${wikiHost}.`);
    noticeVisible.value = false;
  }
}

function move(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= items.value.length) return;
  const reordered = [...items.value];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  items.value = reordered;
}
function removeItem(index) { items.value.splice(index, 1); }

const dragIndex = ref(null);
const dragOverIndex = ref(null);
function onDragStart(index, event) {
  dragIndex.value = index;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', String(index));
}
function onDragOver(index) {
  if (dragIndex.value === null) return;
  dragOverIndex.value = index;
}
function onDrop(index) {
  const from = dragIndex.value;
  resetDrag();
  if (from === null || from === index) return;
  const reordered = [...items.value];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(index, 0, moved);
  items.value = reordered;
}
function resetDrag() {
  dragIndex.value = null;
  dragOverIndex.value = null;
}
function addChapter() {
  const name = window.prompt('Enter name for new chapter');
  if (name) {
    items.value.push({ type: 'chapter', title: name.slice(0, 200) });
    saveBooks();
  }
}
const addPageDialogOpen = ref(false);
const pageSearchSelection = ref(null);
const pageSearchResults = ref([]);

async function onPageSearchInput(value) {
  const term = value.trim();
  if (!term) {
    pageSearchResults.value = [];
    return;
  }
  const query = new URLSearchParams({ action: 'opensearch', search: term, limit: '10', namespace: '0', format: 'json', origin: '*' });
  try {
    const response = await fetch(`${api}?${query}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    // opensearch returns [ term, titles[], descriptions[], urls[] ]
    if (value.trim() !== term) return;
    pageSearchResults.value = (data[1] || []).map((pageTitle) => ({ value: pageTitle, label: pageTitle }));
  } catch {
    pageSearchResults.value = [];
  }
}

async function addPage(pageTitle) {
  const query = new URLSearchParams({ action: 'query', ...pageQueryProps, titles: pageTitle, redirects: '1', format: 'json', formatversion: '2', origin: '*' });
  try {
    const response = await fetch(`${api}?${query}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const page = data?.query?.pages?.[0];
    if (!page || page.missing) {
      showNotice(`Page "${pageTitle}" not found on ${wikiHost}.`, 'warning');
      return;
    }
    items.value.push(pageToItem(page));
    saveBooks();
  } catch (error) {
    showNotice(`Could not add "${pageTitle}": ${error.message}`, 'error');
  }
}

function onPageSelected(value) {
  if (!value) return;
  addPage(value);
  addPageDialogOpen.value = false;
  pageSearchSelection.value = null;
  pageSearchResults.value = [];
}

function renameChapter(index) {
  const name = window.prompt('Enter new name for chapter', items.value[index].title);
  if (name) items.value[index].title = name.slice(0, 200);
}
function sortItems() {
  const output = [];
  let articles = [];
  const flush = () => { output.push(...articles.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'accent' }))); articles = []; };
  items.value.forEach((item) => { if (item.type === 'chapter') { flush(); output.push(item); } else articles.push(item); });
  flush();
  items.value = output;
  saveBooks();
}
function clearItems() {
  if (window.confirm('Do you really want to completely clear your book?')) {
    items.value = [];
    title.value = '';
    subtitle.value = '';
  }
}
function selectBook(bookId) {
  if (!books.value.some((book) => book.id === bookId)) return;
  saveBooks();
  activeBookId.value = bookId;
}
function newBook() {
  const nextId = books.value.reduce((highestId, book) => Math.max(highestId, book.id), -1) + 1;
  books.value.push({
    id: nextId,
    title: `Book ${nextId}`,
    subtitle: `Description for Book ${nextId}`,
    items: [],
    titles: ''
  });
  activeBookId.value = nextId;
  noticeVisible.value = false;
}
function saveBook(event) {
  event.preventDefault();
  const name = saveBookName.value.trim();
  if (!name) return;
  const wikitext = `{{saved book
  |title=${title.value}
  |subtitle=${subtitle.value}
  |cover-image=
  |cover-color=
}}

== ${title.value} ==

${items.value
  .map((item) => item.type === 'chapter' ?
    `=== ${item.title} ===
` : `: [[${item.title}]]
`).join(`
`)}`;
  const bookTitle = `Special:MyPage/Books/${encodeURIComponent(name)}`;
  window.open(`https://${wikiHost}/wiki/${bookTitle}?action=edit&preload=Template:Preload_wikitext&preloadparams[]=${encodeURIComponent(wikitext)}`, '_blank', 'noopener');
}

function previewBook(event) {
  event.preventDefault();
  const form = event.currentTarget;
  form.querySelector('input').value = metabookJson();
  form.submit();
}

function clearBookQuery() {
  window.history.replaceState({}, '', window.location.pathname + window.location.hash);
}

function initializeBookFromQuery() {
  const hasBookQuery = bookQueryParameters.some((parameter) => params.has(parameter));
  if (!hasBookQuery) return null;


  const missingParameters = bookQueryParameters.filter((parameter) => params.get(parameter) === null);
  if (missingParameters.length) {
    showNotice(`Missing book parameter(s): ${missingParameters.join(', ')}.`, 'error');
    return { handled: true };
  }

  const requestedId = Number(params.get('id'));

  const existingBook = books.value.find((book) => book.id === requestedId);
  if (existingBook) {
    activeBookId.value = requestedId;
    clearBookQuery();
    noticeVisible.value = false;
    return { handled: true };
  }

  books.value.push({
    id: requestedId,
    title: params.get('name').trim(),
    subtitle: params.get('desc').trim(),
    items: [],
    titles: params.get('titles').trim()
  });
  activeBookId.value = requestedId;
  clearBookQuery();
  return { handled: true, titles: params.get('titles').trim() };
}

onMounted(() => {
  const queryBook = initializeBookFromQuery();
  if (queryBook?.handled) {
    if (queryBook.titles) loadTitles(queryBook.titles);
    else if (!noticeVisible.value) noticeVisible.value = false;
    return;
  }
  if (activeBook.value.items.length) {
    noticeVisible.value = false;
    return;
  }
  const titles = params.get('titles') || activeBook.value.titles || '';
  if (titles) loadTitles(titles);
  else noticeVisible.value = false;
});
</script>

<template>
  <main class="mw-body">
    <h1>Book creator</h1>
    <CdxMessage v-if="noticeVisible" :type="noticeType">{{ noticeText }}</CdxMessage>
    <div class="book-picker">
      <CdxField label="Book:">
        <CdxSelect v-model:selected="selectedBookId" :menu-items="bookOptions" />
      </CdxField>
      <CdxButton action="progressive" @click="newBook">New book</CdxButton>
    </div>
    <div class="collection-container">
      <section class="collection-column-left">
        <CdxField label="Title:">
          <CdxTextInput placeholder="Title of book" v-model="title" />
        </CdxField>
        <CdxField label="Subtitle:">
          <CdxTextInput placeholder="Description of book" v-model="subtitle" />
        </CdxField>
        <div class="toolbar">
          <CdxButton weight="quiet" @click="addChapter">Create chapter</CdxButton>
          <CdxButton weight="quiet" @click="addPageDialogOpen = true">Add page</CdxButton>
          <CdxButton weight="quiet" @click="sortItems">Sort alphabetically</CdxButton>
          <CdxButton weight="quiet" @click="clearItems">Clear book</CdxButton>
        </div>
        <p v-if="hasItems" class="collection-hint">Drag rows or use the arrow buttons to reorder wiki pages and chapters</p>
        <ul v-if="hasItems" class="collection-list">
          <li
            v-for="(item, index) in items"
            :key="`${item.type}-${item.title}-${index}`"
            :class="[item.type, { missing: item.missing, dragging: dragIndex === index, 'drag-over': dragOverIndex === index && dragIndex !== index }]"
            draggable="true"
            @dragstart="onDragStart(index, $event)"
            @dragover.prevent="onDragOver(index)"
            @drop="onDrop(index)"
            @dragend="resetDrag"
          >
            <span class="reorder">
              <CdxButton weight="quiet" :disabled="index === 0" aria-label="Move up" @click="move(index, -1)">
                <CdxIcon :icon="cdxIconArrowUp" />
              </CdxButton>
              <CdxButton weight="quiet" :disabled="index === items.length - 1" aria-label="Move down" @click="move(index, 1)">
                <CdxIcon :icon="cdxIconArrowDown" />
              </CdxButton>
            </span>
            <img v-if="item.thumbnail" class="item-thumb" :src="item.thumbnail" alt="" width="48" height="48" loading="lazy" draggable="false">
            <span class="item-title">
              <span class="item-title-line">
                <a v-if="item.type === 'article' && !item.missing" :href="item.url" target="_blank" rel="noopener" draggable="false">{{ item.title }}</a>
                <span v-else>{{ item.title }}</span>
                <span v-if="item.revision" class="revlink"> (rev {{ item.revision }})</span>
              </span>
              <span v-if="item.description" class="item-description">{{ item.description }}</span>
            </span>
            <CdxButton v-if="item.type === 'chapter'" weight="quiet" aria-label="Rename chapter" @click="renameChapter(index)">
              <CdxIcon :icon="cdxIconEdit" />
            </CdxButton>
            <CdxButton weight="quiet" aria-label="Remove" @click="removeItem(index)">
              <CdxIcon :icon="cdxIconTrash" />
            </CdxButton>
          </li>
        </ul>
        <p v-else class="empty">Empty book</p>
      </section>
      <aside class="collection-column-right">
        <section class="side-box">
          <h2>Order as a printed book</h2>
          <p>Get a printed book or PDF from our print-on-demand partner PediaPress.</p>
          <form action="https://pediapress.com/api/collections/" method="POST" target="_blank" @submit="previewBook">
            <input type="hidden" name="metabook">
            <CdxButton action="progressive" :disabled="articleCount === 0" type="submit">Preview with PediaPress</CdxButton>
          </form>
        </section>
        <section class="side-box">
          <h2>Save your book</h2>
          <p>Save this book as a page under your user space.</p>
          <form @submit="saveBook">
            <CdxField label="Special:MyPage/Books/"><CdxTextInput v-model="saveBookName" /></CdxField>
            <CdxButton action="progressive" type="submit">Submit</CdxButton>
          </form>
        </section>
        <details class="metabook">
          <summary>View metabook JSON (sent to the render server)</summary>
          <pre>{{ metabookJson(true) }}</pre>
        </details>
      </aside>
    </div>
    <p class="footer">Standalone reimplementation of <code>Special:Book</code> (the MediaWiki <a href="https://www.mediawiki.org/wiki/Extension:Collection">Collection</a> extension). Pages can be supplied via the <code>?titles=A|B|C&wiki=en.wikipedia.org</code> query string and loaded live from <span>{{ wikiHost }}</span>.</p>
    <CdxDialog
      v-model:open="addPageDialogOpen"
      title="Add a page"
      :subtitle="`Search ${wikiHost} for a page to add to your book`"
      close-button-label="Close"
    >
      <CdxLookup
        v-model:selected="pageSearchSelection"
        :menu-items="pageSearchResults"
        placeholder="Search for a page…"
        @input="onPageSearchInput"
        @update:selected="onPageSelected"
      >
        <template #no-results>No matching pages found.</template>
      </CdxLookup>
    </CdxDialog>
  </main>
</template>

<style>
:root { --border: #a2a9b1; --border-light: #c8ccd1; --bg-subtle: #f8f9fa; }
* { box-sizing: border-box; }
body { margin: 0; color: #202122; background: #fff; font-family: sans-serif; font-size: 14px; line-height: 1.5; }
.mw-body { max-width: 1000px; margin: 0 auto; padding: 1em 1.5em 3em; }
h1, h2 { font-family: 'Linux Libertine', Georgia, Times, serif; font-weight: normal; border-bottom: 1px solid var(--border-light); padding-bottom: .25em; }
h1 { margin-bottom: .6em; } h2 { margin: 0 0 .5em; font-size: 1.15em; }
a { color: #36c; text-decoration: none; } a:hover { text-decoration: underline; }
.collection-container { display: flex; gap: 1.5em; flex-wrap: wrap; align-items: flex-start; }
.collection-column-left { flex: 1 1 55%; min-width: 320px; } .collection-column-right { flex: 1 1 30%; min-width: 260px; }
.toolbar { display: flex; gap: .5em; flex-wrap: wrap; margin: 1em 0 .5em; }
.book-picker { align-items: end; display: flex; gap: .75em; margin-bottom: 1em; max-width: 32em; }
.book-picker .cdx-field { flex: 1; }
.collection-hint { color: #54595d; font-size: 95%; font-style: italic; margin: .25em 0 .75em; }
.collection-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--border-light); }
.collection-list li { display: flex; align-items: center; gap: .25em; padding: 4px; border-bottom: 1px solid var(--border-light); cursor: grab; }
.collection-list li.dragging { opacity: .4; }
.collection-list li.drag-over { border-top: 2px solid #36c; }
.collection-list li.article { padding-left: 1.5em; } .collection-list li.chapter { background: #eaecf0; font-weight: bold; }
.reorder { display: flex; flex-direction: column; line-height: .7; } .item-title { flex: 1; display: flex; flex-direction: column; } .missing .item-title { color: #d33; }
.item-thumb { object-fit: cover; border: 1px solid var(--border-light); border-radius: 2px; background: var(--bg-subtle); flex: none; }
.item-description { color: #54595d; font-size: 90%; }
.missing .item-title::after { content: ' (page not found)'; font-size: 90%; font-style: italic; } .revlink { color: #72777d; font-size: 90%; }
.side-box { background: var(--bg-subtle); border: 1px solid var(--border-light); border-radius: 2px; padding: .75em 1em 1em; margin-bottom: 1em; }
.empty { color: #72777d; font-style: italic; padding: 1em 0; } .metabook { border: 1px solid var(--border-light); margin-top: 1em; }
.metabook summary { cursor: pointer; background: var(--bg-subtle); font-weight: bold; padding: .5em .75em; } .metabook pre { margin: 0; max-height: 340px; overflow-x: auto; padding: .75em; font-size: 12px; }
.footer { border-top: 1px solid var(--border-light); color: #72777d; font-size: .85em; margin-top: 2em; padding-top: .75em; } .footer code { background: var(--bg-subtle); padding: 1px 4px; }
</style>
