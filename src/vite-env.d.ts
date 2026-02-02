/// <reference types="vite/client" />

// Declare raw text file imports
declare module "*.txt?raw" {
    const content: string;
    export default content;
}
