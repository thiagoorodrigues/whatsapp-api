import MensagensDisparos from "../../models/MensagensDisparos";

interface MessageData {
    message: string;
    numero: string;
}
interface Request {
    messageData: MessageData;
}

const CreateMensagemDisparoService = async ({ messageData }: Request): Promise<MensagensDisparos> => {

    const message = await MensagensDisparos.create({ numero: messageData.numero, message: messageData.message });

    return message;
};


export default CreateMensagemDisparoService