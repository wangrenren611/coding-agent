export function safeParse(data: string): any | null {

    if(!data){
        return null;
    }

    try {
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

export function safeJSONStringify(data: any): string {
    if(!data){
        return '';
    }

    try {
        return JSON.stringify(data);
    } catch (error) {
        return '';
    }
}