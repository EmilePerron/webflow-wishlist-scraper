const configResult = require('dotenv').config()
const axios = require('axios');
const puppeteer = require('puppeteer');
const wishlistUrl = 'https://wishlist.webflow.com/';
const recentUrlQuery = '?sort=recent';

// Check if a config is defined, otherwise the scraping is useless
if (configResult.error || !configResult.parsed.PUSH_URL) {
    throw new Error("You must define a value for PUSH_URL in your .env file.");
}

let browser;

(async () => {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ DNT: "1" });
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(wishlistUrl, { waitUntil: "networkidle2", timeout: 30000 });

    try {
        const ideasByStatuses = await getAllIdeasByStatus(page);
        const recentIdeas = await getRecentIdeas(page);
        const pushResponse = await pushResults({
            ideasByStatuses,
            recentIdeas,
        });
        console.log('Pushed results to provided endpoint. Response from the endpoint is provided below...');
        console.log(`${pushResponse.status} (${pushResponse.statusText}) : ${pushResponse.data}`);
    } catch (error) {
        console.error(error);
    } finally {
        await browser.close();
    }
})();

function pushResults(data) {
    return axios.post(configResult.parsed.PUSH_URL, data);
}

async function getStatuses(page) {
    return page.evaluate(() => {
        const statuses = [];
        for (const filterLink of document.querySelectorAll('ul.statuses.filters a')) {
            statuses.push({
                name: filterLink.textContent.trim(),
                id: filterLink.getAttribute('data-url-param-toggle-value'),
                url: filterLink.href,
            });
        }
        return statuses;
    });
}

async function getRecentIdeas(page) {
    await page.goto(wishlistUrl + recentUrlQuery, { waitUntil: "networkidle2", timeout: 30000 });
    return await getPageIdeas(page);
}

async function getAllIdeasByStatus(page) {
    const statuses = await getStatuses(page);

    for (const status of statuses) {
        await delay(1500); // No need to be rude to Webflow's servers...
        await page.goto(status.url, { waitUntil: "networkidle2", timeout: 30000 });
        status.ideas = await getAllPaginatedIdeas(page);
    }

    return statuses;
}

async function getAllPaginatedIdeas(page) {
    let ideas = [];

    do {
        ideas = ideas.concat(await getPageIdeas(page));
    } while (await goToNextPage(page));

    return ideas;
}

async function goToNextPage(page) {
    const nextPageUrl = await page.evaluate(() => {
        const nextLink = document.querySelector('.portal-content .pagination a[rel="next"]');
        return nextLink ? nextLink.href : null;
    });

    if (!nextPageUrl) {
        return false;
    }

    await delay(1500); // No need to be rude to Webflow's servers...
    await page.goto(nextPageUrl, { waitUntil: "networkidle2", timeout: 30000 });
    return true;
}

async function getPageIdeas(page) {
    let ideas = await page.evaluate(() => {
        const ideas = [];
        for (const ideaNode of document.querySelectorAll('.portal-content ul.list-ideas > li.idea')) {
            const metaLine1 = ideaNode.querySelector('.idea-meta-created .idea-meta-secondary:first-child').textContent.trim();
            const statusNode = ideaNode.querySelector('.status-pill');
            const ideaUrl = ideaNode.querySelector('.idea-link').href;

            ideas.push({
                name: ideaNode.querySelector('h3').textContent.trim(),
                preview: ideaNode.querySelector('.description').textContent.trim(),
                userImage: ideaNode.querySelector('.avatar img').src,
                userName: metaLine1.replace(/^.+by (.+)\s*$/s, '$1').trim(),
                date: metaLine1.replace(/^Created (.+) by.+\w*$/s, '$1').trim(),
                category: ideaNode.querySelector('.idea-meta-created .idea-meta-secondary:last-child').textContent.trim(),
                voteCount: ideaNode.querySelector('.vote-count').textContent.trim(),
                commentCount: ideaNode.querySelector('.comment-count').textContent.trim(),
                status: statusNode ? statusNode.textContent.trim() : null,
                url: ideaUrl
            });
        }
        return ideas;
    });


    for (const idea of ideas) {
        const contentDetails = await getIdeaContentFromUrl(idea.url);
        idea.contentText = contentDetails.text;
        idea.contentHtml = contentDetails.html;
    }

    return filterIdeasForSpam(ideas);
}

async function getIdeaContentFromUrl(url) {
    await delay(1500); // No need to be rude to Webflow's servers...
    const newPage = await browser.newPage();
    await newPage.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    return await newPage.evaluate(() => {
        const descriptionNode = document.querySelector('.idea-content .description');
        return {
            html: descriptionNode.innerHTML.trim(),
            text: descriptionNode.textContent.trim(),
        };
    });
}

function filterIdeasForSpam(ideas) {
    const webflowRelatedWords = [
        'webflow',
        'wf',
        'user',
        'session',
        'cookie',
        'server',
        'accessibility',
        'account',
        'api',
        'data',
        'hosting',
        'billing',
        'cms',
        'dashboard',
        'designer',
        'ecommerce',
        'forms',
        'hosting',
        'integration',
        'edit',
        'asset',
        'export',
        'site',
        'layout',
        'style',
        'class',
        'element',
        'import',
        'project',
    ];
    const wordChecker = new RegExp(webflowRelatedWords.join("|"));

    return ideas.filter((idea) => {
        return wordChecker.test(idea.contentText);
    });
}

async function getStatuses(page) {
    return page.evaluate(() => {
        const statuses = [];
        for (const filterLink of document.querySelectorAll('ul.statuses.filters a')) {
            statuses.push({
                name: filterLink.textContent.trim(),
                id: filterLink.getAttribute('data-url-param-toggle-value'),
                url: filterLink.href,
            });
        }
        return statuses;
    });
}

function delay(time) {
   return new Promise(function(resolve) {
       setTimeout(resolve, time)
   });
}
