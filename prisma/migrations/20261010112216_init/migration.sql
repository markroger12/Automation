-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EDITOR',
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BrowserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'WORDPRESS',
    "directory" TEXT NOT NULL,
    "sessionStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "sessionDetail" TEXT,
    "lastCheckedAt" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Website" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "adminUrl" TEXT NOT NULL,
    "profileId" TEXT,
    "defaultCategoryId" TEXT,
    "editorType" TEXT NOT NULL DEFAULT 'AUTO',
    "language" TEXT NOT NULL DEFAULT 'English',
    "targetCountry" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "celebrityImages" BOOLEAN NOT NULL DEFAULT true,
    "tigramImages" BOOLEAN NOT NULL DEFAULT true,
    "logoFile" TEXT,
    "accentColour" TEXT,
    "logoPosition" TEXT NOT NULL DEFAULT 'bottom-right',
    "featuredStyle" TEXT NOT NULL DEFAULT 'split',
    "imageTemplate" TEXT,
    "canPublish" BOOLEAN NOT NULL DEFAULT false,
    "siteTimezone" TEXT,
    "searchConsoleProperty" TEXT,
    "internalLinkText" TEXT NOT NULL DEFAULT 'Also read:',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Website_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BrowserProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "wpId" INTEGER,
    "slug" TEXT,
    "parentWpId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Category_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArticleTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleKey" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "exampleTitle" TEXT,
    "secondaryKeywords" TEXT NOT NULL DEFAULT '[]',
    "targetCountry" TEXT NOT NULL DEFAULT 'United States',
    "language" TEXT NOT NULL DEFAULT 'English',
    "websiteId" TEXT,
    "categoryId" TEXT,
    "categoryName" TEXT,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "imagesMode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "currentStage" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "statusMessage" TEXT,
    "reviewReasons" TEXT NOT NULL DEFAULT '[]',
    "loginRequiredFor" TEXT,
    "error" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "titleOptions" TEXT NOT NULL DEFAULT '[]',
    "recommendedTitle" TEXT,
    "selectedTitle" TEXT,
    "titleApprovedAt" DATETIME,
    "articleApprovedAt" DATETIME,
    "bodyHtml" TEXT,
    "contentHtml" TEXT,
    "faqs" TEXT NOT NULL DEFAULT '[]',
    "quickBio" TEXT NOT NULL DEFAULT '[]',
    "seoTitle" TEXT,
    "metaDescription" TEXT,
    "slug" TEXT,
    "focusKeyword" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "wordCount" INTEGER,
    "keywordCount" INTEGER,
    "keywordDensity" REAL,
    "h2Count" INTEGER,
    "h3Count" INTEGER,
    "seoScore" INTEGER,
    "rankMathScore" INTEGER,
    "chatgptConversationUrl" TEXT,
    "wpPostId" INTEGER,
    "wpEditUrl" TEXT,
    "wpPostUrl" TEXT,
    "wpDraftSavedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleTask_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ArticleTask_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArticleStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "prompt" TEXT,
    "output" TEXT,
    "outputHtml" TEXT,
    "data" TEXT,
    "error" TEXT,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleStage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ArticleTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatGPTResponse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "prompt" TEXT NOT NULL,
    "responseText" TEXT NOT NULL,
    "responseHtml" TEXT,
    "conversationUrl" TEXT,
    "reusedExisting" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatGPTResponse_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ArticleTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PromptTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "moduleKey" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "defaultContent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'INFO',
    "category" TEXT NOT NULL DEFAULT 'SYSTEM',
    "stage" TEXT,
    "message" TEXT NOT NULL,
    "data" TEXT,
    "screenshotPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Log_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ArticleTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QueueJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "queue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taskId" TEXT,
    "data" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "result" TEXT,
    "progress" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedBy" TEXT,
    "heartbeatAt" DATETIME,
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "WorkerStatus" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lastSeenAt" DATETIME NOT NULL,
    "info" TEXT
);

-- CreateTable
CREATE TABLE "SEOReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "checks" TEXT NOT NULL,
    "metrics" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SEOReport_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ArticleTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "websiteId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "publishTimes" TEXT NOT NULL DEFAULT '[]',
    "days" TEXT NOT NULL DEFAULT '[]',
    "writeAheadHours" INTEGER NOT NULL DEFAULT 0,
    "images" TEXT,
    "indexAfterPublish" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Workflow_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowKeyword" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "title" TEXT,
    "secondaryKeywords" TEXT NOT NULL DEFAULT '[]',
    "kind" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "kindSource" TEXT,
    "kindNote" TEXT,
    "state" TEXT NOT NULL DEFAULT 'WAITING',
    "taskId" TEXT,
    "publishAt" DATETIME,
    "publishedUrl" TEXT,
    "publishedAt" DATETIME,
    "indexedAt" DATETIME,
    "indexAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextIndexAt" DATETIME,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowKeyword_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowKeyword_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ArticleTask" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BrowserProfile_directory_key" ON "BrowserProfile"("directory");

-- CreateIndex
CREATE UNIQUE INDEX "Category_websiteId_name_key" ON "Category"("websiteId", "name");

-- CreateIndex
CREATE INDEX "ArticleTask_status_idx" ON "ArticleTask"("status");

-- CreateIndex
CREATE INDEX "ArticleTask_websiteId_createdAt_idx" ON "ArticleTask"("websiteId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleStage_taskId_key_key" ON "ArticleStage"("taskId", "key");

-- CreateIndex
CREATE INDEX "ChatGPTResponse_taskId_createdAt_idx" ON "ChatGPTResponse"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromptTemplate_moduleKey_key_key" ON "PromptTemplate"("moduleKey", "key");

-- CreateIndex
CREATE INDEX "Log_taskId_createdAt_idx" ON "Log"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "Log_createdAt_idx" ON "Log"("createdAt");

-- CreateIndex
CREATE INDEX "Log_level_idx" ON "Log"("level");

-- CreateIndex
CREATE INDEX "QueueJob_queue_status_runAt_idx" ON "QueueJob"("queue", "status", "runAt");

-- CreateIndex
CREATE INDEX "QueueJob_taskId_idx" ON "QueueJob"("taskId");

-- CreateIndex
CREATE INDEX "SEOReport_taskId_createdAt_idx" ON "SEOReport"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_websiteId_key" ON "Workflow"("websiteId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowKeyword_taskId_key" ON "WorkflowKeyword"("taskId");

-- CreateIndex
CREATE INDEX "WorkflowKeyword_workflowId_state_idx" ON "WorkflowKeyword"("workflowId", "state");
