export function gerarCodigoUnico(length = 8) {
    const caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let resultado = '';
    let caracteresUsados = [];

    while (resultado.length < length) {
        let charAleatorio = caracteres.charAt(Math.floor(Math.random() * caracteres.length));
        if (!caracteresUsados.includes(charAleatorio)) {
            resultado += charAleatorio;
            caracteresUsados.push(charAleatorio);
        }
    }
    return resultado;
}