workspace "DynamoDB Tools" "Implemented local DynamoDB console; standalone and VS Code packaging are planned, not deployed." {
    model {
        developer = person "Developer" "Browses and manages local or permitted AWS DynamoDB data."
        aws = softwareSystem "AWS DynamoDB and Streams" "Real account data, governed by IAM." "External"
        identity = softwareSystem "AWS credential providers and STS" "SDK credential discovery and verified account identity." "External"
        local = softwareSystem "DynamoDB Local" "Optional local emulator." "External"
        dynamodbTools = softwareSystem "DynamoDB Tools" "Local data workspace with deliberate AWS write protection." {
            browser = container "Browser Console" "Accessible table discovery, editors, queries and operational views." "HTML, CSS, JavaScript"
            api = container "FastAPI Backend" "Connection management, validation, exact data conversion and request protection." "Python, FastAPI, boto3" {
                safety = component "AWS Safety" "Read-only enforcement and exact-request write approvals." "Python"
                data = component "Data Services" "Table, item, query, import, export, Streams and model operations." "Python, boto3"
                queue = component "Operation Queue" "Bounded sequential background tasks and session history." "Python ThreadPoolExecutor"
            }
            preferences = container "Connection Preferences" "Non-secret connection settings persisted on the host." "JSON file"
            browserData = container "Browser Preferences" "Account-scoped saved queries and item schemas." "Browser localStorage"
        }
        developer -> browser "Uses console"
        browser -> api "Calls same-origin API" "HTTP/JSON"
        browser -> browserData "Stores local definitions"
        api -> preferences "Loads and saves non-secret settings"
        api -> identity "Resolves credentials and account identity" "AWS SDK"
        api -> aws "Reads and explicitly confirmed writes" "AWS SDK / HTTPS"
        api -> local "Local database operations" "AWS SDK / HTTP"
        safety -> data "Admits authorized requests"
        data -> queue "Queues long operations"
    }
    views {
        systemContext dynamodbTools "Context" {
            include *
            autoLayout lr
        }
        container dynamodbTools "Containers" {
            include *
            autoLayout lr
        }
        component api "Components" {
            include *
            autoLayout lr
        }
    }
}
